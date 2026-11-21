//! The account's YouTube Music library and server likes.
//!
//! Android's `MusicSessionLibrary` seeds its favourites once from the account's
//! `LM` playlist and its saved collections once from
//! `FEmusic_library_landing`, and every toggle writes through to the account
//! like API, so a favourite here is a real account like, not a local copy.
//! This module is the desktop's copy of that: the library browse, the
//! `like/like` + `like/removelike` writes, and the main-site fallback for
//! playlist likes (a playlist the main site owns answers the music host with
//! 404, the way its edits do — Android report 20).
//!
//! No recommendation engine, brain or scoring lives here: the server decides
//! what the library holds; this module only fetches it and writes likes back.

use serde_json::{Value, json};

use super::endpoints;
use super::parse::{continuation, shelves};
use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::transport::error::{TransportError, to_app_error};
use crate::errors::AppResult;
use crate::models::music::YTItem;
use crate::models::music_pages::MusicLibraryPage;
use crate::security::validation::{validate_playlist_id, validate_video_id};

impl InnertubeClient {
    /// One page of the account's YouTube Music library
    /// (`FEmusic_library_landing` on `WEB_REMIX`, signed in): the saved
    /// playlists and albums, in the server's order. The first page browses the
    /// landing id; later pages continue by token, as Android's
    /// `YouTube.library` / `libraryContinuation` do.
    pub async fn music_library_page(
        &self,
        continuation_token: Option<&str>,
    ) -> AppResult<MusicLibraryPage> {
        self.require_signed_in()?;
        let res = if let Some(token) = continuation_token {
            self.music_browse(None, None, Some(token)).await?
        } else {
            self.music_browse(Some(endpoints::BROWSE_MUSIC_LIBRARY), None, None)
                .await?
        };
        Ok(parse_library_page(&res))
    }

    /// Likes or unlikes one song on the account: `like/like` +
    /// `like/removelike` on the music host, `{context, target: {videoId}}`,
    /// as Android's `YouTube.likeVideo` does. The local likes store stays the
    /// UI's optimistic copy; this is the server write behind it.
    pub async fn set_music_liked(&self, video_id: &str, liked: bool) -> AppResult<()> {
        self.require_signed_in()?;
        validate_video_id(video_id)?;
        let endpoint = if liked { "like/like" } else { "like/removelike" };
        let mut payload = like_payload(LikeTarget::Video(video_id));
        self.post_music_raw(endpoint, &clients::WEB_REMIX, &mut payload)
            .await
            .map_err(|error| to_app_error(endpoint, &error))?;
        Ok(())
    }

    /// Saves or unsaves a playlist in the account library: `like/like` +
    /// `like/removelike` on the music host, `{context, target:
    /// {playlistId}}`, as Android's `YouTube.likePlaylist` does. A playlist
    /// the main site owns answers the music host with 4xx, so only a 4xx is
    /// retried on the main site, where the like carries the session; a 5xx or
    /// transport failure is returned — the like may have applied.
    pub async fn set_music_playlist_saved(
        &self,
        playlist_id: &str,
        saved: bool,
    ) -> AppResult<()> {
        self.require_signed_in()?;
        validate_playlist_id(playlist_id)?;
        let endpoint = if saved { "like/like" } else { "like/removelike" };
        let mut payload = like_payload(LikeTarget::Playlist(playlist_id));
        match self
            .post_music_raw(endpoint, &clients::WEB_REMIX, &mut payload)
            .await
        {
            Ok(_) => Ok(()),
            Err(TransportError::Status { code, .. }) if (400..500).contains(&code) => {
                self.post_innertube(endpoint, &clients::WEB_REMIX, &mut payload)
                    .await?;
                Ok(())
            }
            Err(error) => Err(to_app_error(endpoint, &error)),
        }
    }
}

/// What a like targets: a song by video id, or a playlist by playlist id.
enum LikeTarget<'a> {
    Video(&'a str),
    Playlist(&'a str),
}

/// The like body Android's `LikeBody` sends: `{target: {videoId}}` or
/// `{target: {playlistId}}`. The context is added by the transport; `params`
/// is omitted — Android passes none for these calls, and the server-issued
/// like params only travel with button-driven likes.
fn like_payload(target: LikeTarget<'_>) -> Value {
    match target {
        LikeTarget::Video(video_id) => json!({ "target": { "videoId": video_id } }),
        LikeTarget::Playlist(playlist_id) => {
            json!({ "target": { "playlistId": playlist_id } })
        }
    }
}

/// One page of the library landing response: every section's items (a grid of
/// `musicTwoRowItemRenderer` cards, or a `musicShelfRenderer` of
/// `musicResponsiveListItemRenderer` rows — Android's `YouTube.library` reads
/// exactly these two shapes) plus the continuation token, if any.
fn parse_library_page(res: &Value) -> MusicLibraryPage {
    // A continuation answer carries its items under `continuationContents`.
    if res.get("continuationContents").is_some() {
        return parse_library_continuation(res);
    }
    let sections = shelves::section_list_contents(res);
    let mut items: Vec<YTItem> = Vec::new();
    let mut continuation: Option<String> = None;
    for section in &sections {
        // The token lives on the section's own node (Android reads
        // `gridRenderer.continuations` / `musicShelfRenderer.continuations`),
        // not on the section list around it.
        for (node_key, items_key) in [
            ("gridRenderer", "items"),
            ("musicShelfRenderer", "contents"),
        ] {
            if continuation.is_none() {
                let node = &section[node_key];
                if !node.is_null() {
                    continuation = continuation::any(node, &node[items_key]);
                }
            }
        }
        if let Some(shelf) = shelves::parse_section(section) {
            items.extend(shelf.items);
        }
    }
    let section_list =
        &res["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
            ["content"]["sectionListRenderer"];
    let continuation = continuation
        .or_else(|| continuation::from_continuations(section_list))
        .or_else(|| continuation::from_items(&section_list["contents"]))
        .or_else(|| continuation::from_items(&res["contents"]["sectionListRenderer"]["contents"]));
    MusicLibraryPage { items, continuation }
}

/// A continuation answer: `gridContinuation` items, else
/// `musicShelfContinuation` contents, else `sectionListContinuation` contents
/// — the three shapes Android's `libraryContinuation` reads.
fn parse_library_continuation(res: &Value) -> MusicLibraryPage {
    let contents = &res["continuationContents"];
    if let Some(grid) = contents.get("gridContinuation") {
        let items = shelves::collect_items(&grid["items"]);
        let continuation = continuation::any(grid, &grid["items"]);
        return MusicLibraryPage { items, continuation };
    }
    if let Some(shelf) = contents.get("musicShelfContinuation") {
        let items = shelves::collect_items(&shelf["contents"]);
        let continuation = continuation::any(shelf, &shelf["contents"]);
        return MusicLibraryPage { items, continuation };
    }
    if let Some(list) = contents.get("sectionListContinuation") {
        let mut items: Vec<YTItem> = Vec::new();
        if let Some(arr) = list["contents"].as_array() {
            for section in arr {
                if let Some(shelf) = shelves::parse_section(section) {
                    items.extend(shelf.items);
                }
            }
        }
        let continuation = continuation::any(list, &list["contents"]);
        return MusicLibraryPage { items, continuation };
    }
    MusicLibraryPage { items: Vec::new(), continuation: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn two_row_item(id: &str, title: &str, browse_id: &str) -> Value {
        json!({ "musicTwoRowItemRenderer": {
            "title": { "runs": [{ "text": title }] },
            "subtitle": { "runs": [{ "text": "Playlist" }] },
            "thumbnailRenderer": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                { "url": "https://i.ytimg.com/vi/x/hqdefault.jpg", "width": 120, "height": 90 }
            ] } } },
            "navigationEndpoint": { "browseEndpoint": { "browseId": browse_id } },
            "menu": { "menuRenderer": { "items": [] } },
            "thumbnailOverlay": { "musicItemThumbnailOverlayRenderer": { "content": {
                "musicPlayButtonRenderer": { "playNavigationEndpoint": {
                    "watchPlaylistEndpoint": { "playlistId": id }
                } }
            } } }
        } })
    }

    fn landing_page(sections: Vec<Value>) -> Value {
        json!({ "contents": { "singleColumnBrowseResultsRenderer": { "tabs": [{ "tabRenderer": {
            "content": { "sectionListRenderer": { "contents": sections } }
        }}]}}})
    }

    #[test]
    fn library_grid_page_reads_playlists_and_the_token() {
        let grid = json!({ "gridRenderer": {
            "items": [
                two_row_item("PL1", "My Mix", "VLPL1"),
                two_row_item("PL2", "Road Trip", "VLPL2"),
            ],
            "continuations": [{ "nextContinuationData": { "continuation": "tok-grid" } }]
        } });
        let page = parse_library_page(&landing_page(vec![grid]));
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.continuation.as_deref(), Some("tok-grid"));
        assert!(matches!(&page.items[0], YTItem::Playlist(p) if p.id == "PL1"));
    }

    #[test]
    fn library_shelf_page_reads_rows() {
        let shelf = json!({ "musicShelfRenderer": {
            "title": { "runs": [{ "text": "Playlists" }] },
            "contents": [
                json!({ "musicResponsiveListItemRenderer": {
                    "flexColumns": [
                        { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Chill" }] } } },
                        { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Playlist" }] } } },
                    ],
                    "thumbnail": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                        { "url": "https://i.ytimg.com/vi/x/hqdefault.jpg", "width": 120, "height": 90 }
                    ] } } },
                    "navigationEndpoint": { "browseEndpoint": { "browseId": "VLPL9",
                        "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": {
                            "pageType": "MUSIC_PAGE_TYPE_PLAYLIST" } } } },
                    "menu": { "menuRenderer": { "items": [] } }
                } }),
            ],
            "continuations": [{ "nextContinuationData": { "continuation": "tok-shelf" } }]
        } });
        let page = parse_library_page(&landing_page(vec![shelf]));
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.continuation.as_deref(), Some("tok-shelf"));
        assert!(matches!(&page.items[0], YTItem::Playlist(p) if p.id == "PL9"));
    }

    #[test]
    fn library_continuation_reads_grid_items() {
        let res = json!({ "continuationContents": { "gridContinuation": {
            "items": [two_row_item("PL3", "Late Night", "VLPL3")],
            "continuations": [{ "nextContinuationData": { "continuation": "tok-next" } }]
        } } });
        let page = parse_library_page(&res);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.continuation.as_deref(), Some("tok-next"));
    }

    #[test]
    fn like_payload_targets_a_video_or_a_playlist() {
        assert_eq!(
            like_payload(LikeTarget::Video("vid00000001")),
            json!({ "target": { "videoId": "vid00000001" } })
        );
        assert_eq!(
            like_payload(LikeTarget::Playlist("PL123")),
            json!({ "target": { "playlistId": "PL123" } })
        );
    }
}
