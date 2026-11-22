//! The language the site writes its text in (`hl`): titles stay as uploaded,
//! but dates, counts, labels and auto-translated titles follow it. Player
//! requests always use English, which every playability rule is written for.
//!
//! The country (`gl`) is the same idea for what the site offers: trending, search
//! and feeds follow the one the user chose. Player requests always say `US`.

use std::sync::RwLock;

/// The setting naming the content language; empty means English.
pub const CONTENT_LANGUAGE_SETTING: &str = "content_language";

/// The setting naming the content country; missing or unusable means `US`.
pub const CONTENT_COUNTRY_SETTING: &str = "trending_region";

/// The setting naming the music content language; empty follows the content language.
pub const MUSIC_CONTENT_LANGUAGE_SETTING: &str = "music_content_language";

/// The setting naming the music content country; empty follows the content country.
pub const MUSIC_CONTENT_COUNTRY_SETTING: &str = "music_content_country";

static CONTENT_LANGUAGE: RwLock<String> = RwLock::new(String::new());
static CONTENT_COUNTRY: RwLock<String> = RwLock::new(String::new());
static MUSIC_CONTENT_LANGUAGE: RwLock<String> = RwLock::new(String::new());
static MUSIC_CONTENT_COUNTRY: RwLock<String> = RwLock::new(String::new());

/// The host language the site accepts for a language tag, as the Android app
/// normalises it: the bare language, Brazilian and European Portuguese and the
/// three Chinese variants told apart, and English for anything unusable.
#[must_use]
pub fn normalize_host_language(tag: &str) -> String {
    let tag = tag.trim().replace('_', "-");
    let mut subtags = tag.split('-').filter(|part| !part.is_empty());
    let language = subtags.next().unwrap_or_default().to_ascii_lowercase();
    let rest: Vec<String> = subtags.map(str::to_ascii_lowercase).collect();
    let has = |value: &str| rest.iter().any(|part| part == value);
    if language.is_empty()
        || language == "und"
        || language == "system"
        || language == "kab"
        || !language.chars().all(|c| c.is_ascii_alphabetic())
    {
        return "en".to_string();
    }
    match language.as_str() {
        "pt" if has("br") => "pt-BR".to_string(),
        "zh" if has("hk") => "zh-HK".to_string(),
        "zh" if has("hant") || has("tw") || has("mo") => "zh-TW".to_string(),
        "zh" => "zh-CN".to_string(),
        _ => language,
    }
}

/// Set the content language from the saved setting; empty or missing is English.
pub fn set_content_language(setting: Option<&str>) {
    let language = setting
        .filter(|value| !value.trim().is_empty())
        .map_or_else(|| "en".to_string(), normalize_host_language);
    *CONTENT_LANGUAGE
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = language;
}

#[must_use]
pub fn content_language() -> String {
    let language = CONTENT_LANGUAGE
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if language.is_empty() {
        "en".to_string()
    } else {
        language
    }
}

/// A two-letter country code in the form the site takes, or `US` for anything else.
#[must_use]
pub fn normalize_country(code: Option<&str>) -> String {
    let code = code.unwrap_or_default().trim().to_ascii_uppercase();
    if code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()) {
        code
    } else {
        "US".to_string()
    }
}

/// Set the content country from the saved setting.
pub fn set_content_country(setting: Option<&str>) {
    *CONTENT_COUNTRY
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = normalize_country(setting);
}

#[must_use]
pub fn content_country() -> String {
    let country = CONTENT_COUNTRY
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if country.is_empty() {
        "US".to_string()
    } else {
        country
    }
}

/// Whether the site's text is English, which the English-only readers assume.
#[must_use]
pub fn is_english() -> bool {
    content_language() == "en"
}

/// Set the music content language from the saved setting; empty follows the content language.
pub fn set_music_content_language(setting: Option<&str>) {
    let language = setting
        .filter(|value| !value.trim().is_empty())
        .map_or_else(String::new, |value| normalize_host_language(value));
    *MUSIC_CONTENT_LANGUAGE
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = language;
}

/// The music language: the music setting when set, else the content language.
#[must_use]
pub fn music_content_language() -> String {
    let language = MUSIC_CONTENT_LANGUAGE
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if language.is_empty() {
        content_language()
    } else {
        language
    }
}

/// Set the music content country from the saved setting; empty or unusable follows the content country.
pub fn set_music_content_country(setting: Option<&str>) {
    let country = setting
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_uppercase)
        .filter(|code| code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()))
        .unwrap_or_default();
    *MUSIC_CONTENT_COUNTRY
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = country;
}

/// The music country: the music setting when set, else the content country.
#[must_use]
pub fn music_content_country() -> String {
    let country = MUSIC_CONTENT_COUNTRY
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if country.is_empty() {
        content_country()
    } else {
        country
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn countries_are_two_letters_or_us() {
        assert_eq!(normalize_country(Some(" de ")), "DE");
        assert_eq!(normalize_country(Some("USA")), "US");
        assert_eq!(normalize_country(Some("1a")), "US");
        assert_eq!(normalize_country(Some("")), "US");
        assert_eq!(normalize_country(None), "US");
    }

    #[test]
    fn host_languages_follow_app_for_android() {
        assert_eq!(normalize_host_language("system"), "en");
        assert_eq!(
            normalize_host_language("en-DE-u-fw-mon-ms-metric-mu-celsius"),
            "en"
        );
        assert_eq!(normalize_host_language("pt-BR"), "pt-BR");
        assert_eq!(normalize_host_language("pt-PT"), "pt");
        assert_eq!(normalize_host_language("zh-Hant-TW-u-nu-hanidec"), "zh-TW");
        assert_eq!(normalize_host_language("zh-Hant-HK"), "zh-HK");
        assert_eq!(normalize_host_language("zh"), "zh-CN");
        assert_eq!(normalize_host_language("kab"), "en");
        assert_eq!(normalize_host_language("und"), "en");
        assert_eq!(normalize_host_language("de_AT"), "de");
    }

    #[test]
    fn music_locale_falls_back_to_content_locale_when_unset() {
        set_content_language(Some("de"));
        set_content_country(Some("DE"));
        set_music_content_language(None);
        set_music_content_country(Some(""));
        assert_eq!(music_content_language(), "de");
        assert_eq!(music_content_country(), "DE");

        set_music_content_language(Some("fr"));
        set_music_content_country(Some("jp"));
        assert_eq!(music_content_language(), "fr");
        assert_eq!(music_content_country(), "JP");

        set_music_content_country(Some("USA"));
        assert_eq!(music_content_country(), "DE");
        set_music_content_language(Some(""));
        assert_eq!(music_content_language(), "de");

        set_music_content_language(None);
        set_music_content_country(None);
        set_content_language(Some("en"));
        set_content_country(Some("US"));
    }
}
