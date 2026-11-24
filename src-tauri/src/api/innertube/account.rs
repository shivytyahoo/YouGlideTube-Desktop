//! The signed-in Google account's display identity, fetched from
//! InnerTube `account/account_menu` — Android's `YouTube.accountInfo()`.
//!
//! The call needs the signed-in session (the transport adds SAPISIDHASH
//! auth fresh per call), so it errors while signed out. The response
//! shape is parsed in `crate::auth::identity`; this module only owns
//! the request.

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::auth::identity::{AccountInfo, parse_account_info};
use crate::errors::{AppError, AppResult};

impl InnertubeClient {
    /// Fetch the signed-in account's name, email, channel handle and
    /// photo from `account/account_menu` (WEB_REMIX client, like Android).
    /// Returns the cached identity's replacement; the caller persists it.
    pub async fn account_info(&self) -> AppResult<AccountInfo> {
        if self
            .auth
            .as_ref()
            .is_none_or(|session| !session.is_signed_in())
        {
            return Err(AppError::Validation(
                "Not signed in — sign in with Google first to see the account.".to_string(),
            ));
        }
        let mut payload = serde_json::json!({});
        let response = self
            .post_innertube("account/account_menu", &clients::WEB_REMIX, &mut payload)
            .await?;
        parse_account_info(&response).ok_or_else(|| {
            AppError::Extractor(
                "account_menu returned no signed-in account — the session may have expired."
                    .to_string(),
            )
        })
    }
}
