//! Community posts and what they carry.

use serde_json::Value;

use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::largest_url;
use crate::api::innertube::renderers::video::video_from_renderer;
use crate::models::channel::{PollChoice, PostAttachment, PostSummary, QuizChoice};

/// A post renderer: `backstagePostRenderer` on the Posts tab, `postRenderer` on Home.
pub(crate) fn post_renderer(node: &Value) -> Option<&Value> {
    node["backstagePostThreadRenderer"]["post"]
        .get("backstagePostRenderer")
        .or_else(|| node.get("backstagePostRenderer"))
        .or_else(|| node.get("postRenderer"))
}

#[must_use]
pub(crate) fn post(renderer: &Value) -> Option<PostSummary> {
    let id = renderer["postId"].as_str().filter(|id| !id.is_empty())?;
    let reply =
        &renderer["actionButtons"]["commentActionButtonsRenderer"]["replyButton"]["buttonRenderer"];
    let comment_endpoint = &reply["navigationEndpoint"];
    let like_toggle = &renderer["actionButtons"]["commentActionButtonsRenderer"]["likeButton"]["toggleButtonRenderer"];
    Some(PostSummary {
        id: id.to_string(),
        author_name: text_of(&renderer["authorText"]).unwrap_or_default(),
        author_channel_id: renderer["authorEndpoint"]["browseEndpoint"]["browseId"]
            .as_str()
            .filter(|id| id.starts_with("UC"))
            .map(ToOwned::to_owned),
        author_avatar: largest_url(&renderer["authorThumbnail"]["thumbnails"]).map(|url| {
            url.strip_prefix("//")
                .map_or(url.clone(), |rest| format!("https://{rest}"))
        }),
        text_content: text_of(&renderer["contentText"]).filter(|text| !text.is_empty()),
        attachment: attachment(&renderer["backstageAttachment"]),
        likes_count_text: text_of(&renderer["voteCount"]),
        comment_count_text: text_of(&reply["text"]).or_else(|| {
            reply["accessibility"]["label"]
                .as_str()
                .map(ToOwned::to_owned)
        }),
        comment_endpoint_params: comment_endpoint["browseEndpoint"]["params"]
            .as_str()
            .or_else(|| {
                comment_endpoint["signInEndpoint"]["nextEndpoint"]["browseEndpoint"]["params"]
                    .as_str()
            })
            .map(ToOwned::to_owned),
        published_time_text: text_of(&renderer["publishedTimeText"]),
        is_liked: like_toggle["isToggled"].as_bool().unwrap_or(false),
        like_action: endpoint_json(&like_toggle["defaultServiceEndpoint"]).or_else(|| {
            endpoint_json(
                &renderer["actionButtons"]["commentActionButtonsRenderer"]["likeButton"]
                    ["buttonRenderer"]["serviceEndpoint"],
            )
        }),
        unlike_action: endpoint_json(&like_toggle["toggledServiceEndpoint"]),
    })
}

/// A service endpoint as the JSON the like call posts, when it is one.
fn endpoint_json(value: &Value) -> Option<String> {
    value.as_object().map(|_| value.to_string())
}

fn image_url(renderer: &Value) -> Option<String> {
    largest_url(&renderer["image"]["thumbnails"])
        .or_else(|| largest_url(&renderer["image"]["sources"]))
}

/// The multi-image case is read first: it nests one image renderer per
/// picture, so stopping at the first image would keep picture one of N.
fn attachment(node: &Value) -> Option<PostAttachment> {
    if let Some(images) = node["postMultiImageRenderer"]["images"].as_array() {
        let urls: Vec<String> = images
            .iter()
            .filter_map(|image| image_url(&image["backstageImageRenderer"]))
            .collect();
        if !urls.is_empty() {
            return Some(PostAttachment::Images { urls });
        }
    }
    if let Some(url) = node.get("backstageImageRenderer").and_then(image_url) {
        return Some(PostAttachment::Images { urls: vec![url] });
    }
    if let Some(poll) = node.get("pollRenderer") {
        let choices: Vec<PollChoice> = poll["choices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|choice| {
                Some(PollChoice {
                    text: text_of(&choice["text"])?,
                    vote_ratio: choice["voteRatioIfSelected"].as_f64(),
                    vote_count_text: text_of(&choice["numVotes"])
                        .or_else(|| text_of(&choice["votePercentageIfSelected"])),
                })
            })
            .collect();
        if !choices.is_empty() {
            return Some(PostAttachment::Poll {
                choices,
                total_votes_text: text_of(&poll["totalVotes"]),
            });
        }
    }
    if let Some(quiz) = node.get("quizRenderer") {
        let choices: Vec<QuizChoice> = quiz["choices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|choice| {
                Some(QuizChoice {
                    text: text_of(&choice["text"])?,
                    is_correct: choice["isCorrect"].as_bool().unwrap_or(false),
                    explanation: text_of(&choice["explanation"])
                        .map(|text| text.trim().to_string()),
                })
            })
            .collect();
        if !choices.is_empty() {
            return Some(PostAttachment::Quiz {
                choices,
                total_votes_text: text_of(&quiz["totalVotes"]),
            });
        }
    }
    node.get("videoRenderer")
        .and_then(video_from_renderer)
        .map(|video| PostAttachment::Video {
            video: Box::new(video),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn image(url: &str) -> Value {
        json!({ "backstageImageRenderer": { "image": { "thumbnails": [{ "url": url, "width": 100, "height": 100 }] } } })
    }

    #[test]
    fn every_picture_of_a_gallery_is_kept() {
        let node = json!({ "postMultiImageRenderer": { "images": [image("https://a/1"), image("https://a/2")] } });
        assert!(
            matches!(attachment(&node), Some(PostAttachment::Images { urls }) if urls.len() == 2)
        );
    }

    #[test]
    fn a_quiz_keeps_its_answer_and_explanations() {
        let node = json!({ "quizRenderer": { "choices": [
            { "text": { "runs": [{ "text": "Crossbow" }] }, "isCorrect": false, "explanation": { "runs": [{ "text": "No. " }] } },
            { "text": { "runs": [{ "text": "Catapult" }] }, "isCorrect": true }
        ], "totalVotes": { "simpleText": "12K votes" } } });
        let Some(PostAttachment::Quiz {
            choices,
            total_votes_text,
        }) = attachment(&node)
        else {
            panic!("quiz");
        };
        assert!(choices[1].is_correct && !choices[0].is_correct);
        assert_eq!(choices[0].explanation.as_deref(), Some("No."));
        assert_eq!(total_votes_text.as_deref(), Some("12K votes"));
    }

    #[test]
    fn a_post_is_read_from_either_renderer() {
        let thread = json!({ "backstagePostThreadRenderer": { "post": { "backstagePostRenderer": {
            "postId": "Ugkx1", "authorText": { "runs": [{ "text": "LTT" }] },
            "contentText": { "runs": [{ "text": "Hello" }] }, "voteCount": { "simpleText": "1.2K" }
        } } } });
        let post = post(post_renderer(&thread).expect("renderer")).expect("post");
        assert_eq!(post.id, "Ugkx1");
        assert_eq!(post.likes_count_text.as_deref(), Some("1.2K"));
        assert!(post_renderer(&json!({ "postRenderer": { "postId": "Ugkx2" } })).is_some());
    }

    #[test]
    fn a_post_keeps_its_like_toggle() {
        let thread = json!({ "backstagePostThreadRenderer": { "post": { "backstagePostRenderer": {
            "postId": "Ugkx1", "voteCount": { "simpleText": "1.2K" },
            "actionButtons": { "commentActionButtonsRenderer": { "likeButton": { "toggleButtonRenderer": {
                "isToggled": true,
                "defaultServiceEndpoint": { "performCommentActionEndpoint": { "actions": [{ "type": "like" }] } },
                "toggledServiceEndpoint": { "performCommentActionEndpoint": { "actions": [{ "type": "unlike" }] } }
            } } } }
        } } } });
        let post = post(post_renderer(&thread).expect("renderer")).expect("post");
        assert!(post.is_liked);
        assert!(
            post.like_action
                .as_deref()
                .is_some_and(|action| action.contains("performCommentActionEndpoint"))
        );
        assert!(
            post.unlike_action
                .as_deref()
                .is_some_and(|action| action.contains("performCommentActionEndpoint"))
        );
    }

    #[test]
    fn a_post_without_a_like_toggle_has_no_like_action() {
        let thread = json!({ "backstagePostThreadRenderer": { "post": { "backstagePostRenderer": {
            "postId": "Ugkx1", "voteCount": { "simpleText": "1.2K" }
        } } } });
        let post = post(post_renderer(&thread).expect("renderer")).expect("post");
        assert!(!post.is_liked);
        assert_eq!(post.like_action, None);
        assert_eq!(post.unlike_action, None);
    }
}
