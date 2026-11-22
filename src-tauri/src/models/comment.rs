use serde::{Deserialize, Serialize};

use crate::models::rich_text::RichText;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub author_thumbnail: Option<String>,
    pub author_channel_id: Option<String>,
    pub text: String,
    pub published_text: Option<String>,
    pub like_count: Option<u64>,
    pub reply_count: Option<u64>,
    pub continuation_token: Option<String>,
    /// The text with its links, timestamps and custom emoji.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_text: Option<RichText>,
    /// "26K", as the comment shows it.
    #[serde(default)]
    pub like_count_text: Option<String>,
    #[serde(default)]
    pub is_pinned: bool,
    /// "Pinned by @Creator".
    #[serde(default)]
    pub pinned_text: Option<String>,
    #[serde(default)]
    pub is_hearted: bool,
    /// "❤ by @Creator".
    #[serde(default)]
    pub hearted_by_text: Option<String>,
    #[serde(default)]
    pub is_verified: bool,
    /// The comment is by the video's own channel.
    #[serde(default)]
    pub is_creator: bool,
    #[serde(default)]
    pub is_artist: bool,
    /// The reply dialog's own token (`createCommentReplyEndpoint.createReplyParams`),
    /// from the comment's toolbar surface. Null when replies can't be posted
    /// (signed out, or a legacy renderer) — never the create box's token.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_params: Option<String>,
    /// The path the reply posts to; `comment/create_comment_reply` when the
    /// command names none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_path: Option<String>,
    /// The comment is the viewer's own.
    #[serde(default)]
    pub is_own: bool,
    /// The own comment's delete perform-action endpoint, as raw JSON to replay
    /// verbatim. Null unless the comment is the viewer's own and its menu
    /// carried a delete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delete_action: Option<String>,
}

/// One way to order the comments, and the token that loads them that way.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentSort {
    pub title: String,
    pub token: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentsResponse {
    pub comments: Vec<Comment>,
    pub next_page_token: Option<String>,
    pub comment_count_text: Option<String>,
    /// Top and Newest, from the first page's header.
    #[serde(default)]
    pub sort_options: Vec<CommentSort>,
    /// The exact count from that header ("2,460,273").
    #[serde(default)]
    pub total_count: Option<u64>,
    /// The creator turned comments off.
    #[serde(default)]
    pub comments_disabled: bool,
    /// The comment box token, when the page carried one: posting needs it,
    /// and it only exists for a signed-in session. Absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create_comment_params: Option<String>,
}
