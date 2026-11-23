//! The block under the player: title, views, dates, likes, the hashtags above
//! the title and the badges under it.

use serde_json::Value;

use super::info_renderers;
use crate::api::innertube::json::text::text_of;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct WatchPrimary {
    pub title: Option<String>,
    pub view_count_text: Option<String>,
    /// "Oct 24, 2009".
    pub published_text: Option<String>,
    /// "16 years ago".
    pub relative_published_text: Option<String>,
    pub like_count_text: Option<String>,
    /// The button-issued token for `like/like`, from the like button's
    /// `likeEndpoint`; `None` when the watch answer carries none.
    pub like_params: Option<String>,
    /// The button-issued token for `like/removelike`, from the toggled
    /// like button's `likeEndpoint`.
    pub remove_like_params: Option<String>,
    /// The button-issued token for `like/like` with a dislike, from the
    /// dislike button's `likeEndpoint`; `None` when the watch answer
    /// carries none. The old dislike call sent `like/removelike` with the
    /// like button's token instead, which never records a dislike — and
    /// on a never-liked video there is nothing to remove, so the server
    /// refuses it and the button falls back.
    pub dislike_params: Option<String>,
    /// The button-issued token for removing a dislike, from the toggled
    /// dislike button's `likeEndpoint`.
    pub remove_dislike_params: Option<String>,
    pub hashtags: Vec<String>,
    pub badges: Vec<String>,
}

#[must_use]
pub fn primary(next: &Value) -> WatchPrimary {
    let primary = info_renderers(next).0;
    let (like_params, remove_like_params, dislike_params, remove_dislike_params) =
        like_dislike_button_params(primary);
    WatchPrimary {
        title: text_of(&primary["title"]),
        view_count_text: view_count_text(primary),
        published_text: text_of(&primary["dateText"]),
        relative_published_text: text_of(&primary["relativeDateText"]),
        like_count_text: like_count_text(primary),
        like_params,
        remove_like_params,
        dislike_params,
        remove_dislike_params,
        hashtags: hashtags(primary),
        badges: primary["badges"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|badge| badge["metadataBadgeRenderer"]["label"].as_str())
            .map(ToOwned::to_owned)
            .collect(),
    }
}

/// The view count with every run kept, so a live stream reads "197 watching
/// now" instead of "197".
fn view_count_text(primary: &Value) -> Option<String> {
    let renderer = &primary["viewCount"]["videoViewCountRenderer"];
    text_of(&renderer["viewCount"])
        .or_else(|| text_of(&renderer["shortViewCount"]))
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn like_count_text(primary: &Value) -> Option<String> {
    primary["videoActions"]["menuRenderer"]["topLevelButtons"]
        .as_array()?
        .iter()
        .find_map(|button| {
            let view_model = button.get("segmentedLikeDislikeButtonViewModel")?;
            like_count_from_button(
                &view_model["likeButtonViewModel"]["likeButtonViewModel"]["toggleButtonViewModel"]
                    ["toggleButtonViewModel"]["defaultButtonViewModel"]["buttonViewModel"],
            )
        })
}

/// The like and dislike buttons' issued tokens, harvested from their
/// `likeEndpoint`s. Only each button's own subtree is searched, in document
/// order, so the dislike button's tokens never leak into the like's and
/// vice versa: the default like button carries `likeParams` (to like), its
/// toggled button `removeLikeParams` (to unlike), the default dislike
/// button `dislikeParams` (to dislike), its toggled button
/// `removeLikeParams` (to un-dislike). The search is recursive because the
/// endpoint hides behind a sign-in modal for signed-out answers and sits
/// directly on the tap for signed-in ones. The server 403s `like/like`
/// without the button-issued token, so a call without these params is a
/// call the server refuses.
fn like_dislike_button_params(
    primary: &Value,
) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let Some(segmented) = primary["videoActions"]["menuRenderer"]["topLevelButtons"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|button| button.get("segmentedLikeDislikeButtonViewModel"))
    else {
        return (None, None, None, None);
    };
    let like_toggle = &segmented["likeButtonViewModel"]["likeButtonViewModel"]["toggleButtonViewModel"]
        ["toggleButtonViewModel"];
    let dislike_toggle = &segmented["dislikeButtonViewModel"]["dislikeButtonViewModel"]
        ["toggleButtonViewModel"]["toggleButtonViewModel"];
    (
        find_like_endpoint_param(like_toggle, "likeParams"),
        find_like_endpoint_param(like_toggle, "removeLikeParams"),
        find_like_endpoint_param(dislike_toggle, "dislikeParams"),
        find_like_endpoint_param(dislike_toggle, "removeLikeParams"),
    )
}

/// First `likeEndpoint` in the subtree carrying the named param, in
/// document order.
fn find_like_endpoint_param(value: &Value, key: &str) -> Option<String> {
    match value {
        Value::Object(map) => {
            if let Some(param) = map
                .get("likeEndpoint")
                .and_then(|endpoint| endpoint.get(key))
                .and_then(Value::as_str)
                .filter(|param| !param.is_empty())
            {
                return Some(param.to_string());
            }
            map.values()
                .find_map(|child| find_like_endpoint_param(child, key))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|child| find_like_endpoint_param(child, key)),
        _ => None,
    }
}

/// The like button's `title` ("26K"), else the number in its accessibility
/// label. A title without a digit is the hidden-likes "Like".
fn like_count_from_button(button: &Value) -> Option<String> {
    text_of(&button["title"])
        .filter(|title| title.chars().any(|c| c.is_ascii_digit()))
        .or_else(|| {
            button["accessibilityText"]
                .as_str()
                .and_then(number_in_label)
        })
}

fn number_in_label(text: &str) -> Option<String> {
    text.split_whitespace()
        .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric() && c != ',' && c != '.'))
        .find(|word| word.chars().any(|c| c.is_ascii_digit()))
        .map(ToOwned::to_owned)
}

fn hashtags(primary: &Value) -> Vec<String> {
    primary["superTitleLink"]["runs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|run| run["text"].as_str())
        .map(str::trim)
        .filter(|text| text.starts_with('#') && text.len() > 1)
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn next_with(primary: &Value) -> Value {
        json!({ "contents": { "twoColumnWatchNextResults": { "results": { "results": {
            "contents": [{ "videoPrimaryInfoRenderer": primary }]
        } } } } })
    }

    #[test]
    fn live_view_count_keeps_every_run() {
        let live = json!({ "viewCount": { "videoViewCountRenderer": {
            "viewCount": { "runs": [{ "text": "197" }, { "text": " watching now" }] },
            "isLive": true
        } } });
        assert_eq!(view_count_text(&live).as_deref(), Some("197 watching now"));

        let vod = json!({ "viewCount": { "videoViewCountRenderer": {
            "viewCount": { "simpleText": "1,234,567 views" }
        } } });
        assert_eq!(view_count_text(&vod).as_deref(), Some("1,234,567 views"));
    }

    #[test]
    fn like_count_reads_the_title_string_and_needs_a_digit() {
        assert_eq!(
            like_count_from_button(&json!({ "title": "26K" })).as_deref(),
            Some("26K")
        );
        assert_eq!(
            like_count_from_button(&json!({
                "title": "Like",
                "accessibilityText": "like this video along with 26,104 other people"
            }))
            .as_deref(),
            Some("26,104")
        );
        assert_eq!(
            like_count_from_button(&json!({ "title": "Like", "accessibilityText": "I like this" })),
            None
        );
    }

    #[test]
    fn like_params_come_from_the_like_button_only() {
        let next = next_with(&json!({
            "videoActions": { "menuRenderer": { "topLevelButtons": [
                { "segmentedLikeDislikeButtonViewModel": {
                    "likeButtonViewModel": { "likeButtonViewModel": { "toggleButtonViewModel": { "toggleButtonViewModel": {
                        "defaultButtonViewModel": { "buttonViewModel": {
                            "title": "26K",
                            "onTap": { "innertubeCommand": { "likeEndpoint": {
                                "status": "LIKE", "target": { "videoId": "vid" }, "likeParams": "LIKE_PARAMS"
                            } } }
                        } },
                        "toggledButtonViewModel": { "buttonViewModel": {
                            "onTap": { "innertubeCommand": { "likeEndpoint": {
                                "status": "INDIFFERENT", "target": { "videoId": "vid" }, "removeLikeParams": "REMOVE_PARAMS"
                            } } }
                        } }
                    } } } },
                    "dislikeButtonViewModel": { "dislikeButtonViewModel": { "toggleButtonViewModel": { "toggleButtonViewModel": {
                        "defaultButtonViewModel": { "buttonViewModel": {
                            "onTap": { "innertubeCommand": { "likeEndpoint": {
                                "status": "DISLIKE", "target": { "videoId": "vid" }, "dislikeParams": "DISLIKE_PARAMS"
                            } } }
                        } },
                        "toggledButtonViewModel": { "buttonViewModel": {
                            "onTap": { "innertubeCommand": { "likeEndpoint": {
                                "status": "INDIFFERENT", "target": { "videoId": "vid" }, "removeLikeParams": "DISLIKE_REMOVE_PARAMS"
                            } } }
                        } }
                    } } } }
                } }
            ] } }
        }));
        let primary = primary(&next);
        assert_eq!(primary.like_params.as_deref(), Some("LIKE_PARAMS"));
        assert_eq!(primary.remove_like_params.as_deref(), Some("REMOVE_PARAMS"));
        assert_eq!(primary.dislike_params.as_deref(), Some("DISLIKE_PARAMS"));
        assert_eq!(
            primary.remove_dislike_params.as_deref(),
            Some("DISLIKE_REMOVE_PARAMS")
        );
    }

    #[test]
    fn like_params_are_found_behind_the_sign_in_modal() {
        // Signed-out answers hide the like endpoint behind a sign-in modal;
        // the harvest must still find it.
        let next = next_with(&json!({
            "videoActions": { "menuRenderer": { "topLevelButtons": [
                { "segmentedLikeDislikeButtonViewModel": {
                    "likeButtonViewModel": { "likeButtonViewModel": { "toggleButtonViewModel": { "toggleButtonViewModel": {
                        "defaultButtonViewModel": { "buttonViewModel": {
                            "title": "19M",
                            "onTap": { "serialCommand": { "commands": [
                                { "logGestureCommand": {} },
                                { "innertubeCommand": { "modalEndpoint": { "modal": { "modalWithTitleAndButtonRenderer": {
                                    "button": { "buttonRenderer": { "navigationEndpoint": { "signInEndpoint": {
                                        "nextEndpoint": { "likeEndpoint": {
                                            "status": "LIKE", "target": { "videoId": "vid" }, "likeParams": "MODAL_LIKE_PARAMS"
                                        } }
                                    } } } }
                                } } } } }
                    ] } } }
                } } } }
            } } }
        ] } }
    }));
        let primary = primary(&next);
        assert_eq!(primary.like_params.as_deref(), Some("MODAL_LIKE_PARAMS"));
        assert_eq!(primary.remove_like_params, None);
    }

    #[test]
    fn both_dates_hashtags_and_badges_are_kept() {
        let next = next_with(&json!({
            "title": { "runs": [{ "text": "Never Gonna Give You Up" }] },
            "dateText": { "simpleText": "Oct 24, 2009" },
            "relativeDateText": { "simpleText": "16 years ago" },
            "superTitleLink": { "runs": [{ "text": "#RickAstley" }, { "text": " " }, { "text": "#80s" }] },
            "badges": [{ "metadataBadgeRenderer": { "label": "Unlisted" } }]
        }));
        let primary = primary(&next);
        assert_eq!(primary.title.as_deref(), Some("Never Gonna Give You Up"));
        assert_eq!(primary.published_text.as_deref(), Some("Oct 24, 2009"));
        assert_eq!(
            primary.relative_published_text.as_deref(),
            Some("16 years ago")
        );
        assert_eq!(primary.hashtags, ["#RickAstley", "#80s"]);
        assert_eq!(primary.badges, ["Unlisted"]);
    }
}
