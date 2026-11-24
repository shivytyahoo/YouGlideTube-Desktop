//! One-shot spoken queries through the OS speech recognizer.
//!
//! The desktop webviews expose no Web Speech `SpeechRecognition` (WebView2
//! and WKWebView both omit it), so a mic tap on desktop could only ever
//! report "not available". On Windows the WinRT `SpeechRecognizer` fills
//! that gap: it listens on the default microphone with the OS recognizer
//! and returns the recognised text, the same free-form spoken query
//! Android gets from `RecognizerIntent`. Other platforms have no native
//! path and report `VoiceSearchUnsupported`, so the frontend can still
//! try the web recognizer where one exists.

use crate::errors::AppError;

/// Listens once and returns the recognised text, or `None` when the user
/// cancelled before speaking. `lang` is a BCP-47 tag such as `en-US`;
/// the recognizer falls back to `en-US` and then the system default when
/// the requested language has no recognizer installed.
pub async fn listen(lang: Option<String>) -> Result<Option<String>, AppError> {
    #[cfg(windows)]
    {
        return imp::listen_windows(lang).await;
    }
    #[cfg(not(windows))]
    {
        let _ = lang;
        Err(AppError::VoiceSearchUnsupported(
            "this platform has no native speech recognizer".to_string(),
        ))
    }
}

/// Cancels an in-flight `listen`, if any. A no-op elsewhere.
pub fn cancel() {
    #[cfg(windows)]
    imp::cancel();
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    use windows::Foundation::TimeSpan;
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::{
        ISpeechRecognitionConstraint, SpeechRecognitionResultStatus, SpeechRecognitionScenario,
        SpeechRecognitionTopicConstraint, SpeechRecognizer,
    };
    use windows::Win32::Foundation::E_ACCESSDENIED;
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
    use windows::core::{HSTRING, Interface};
    use windows_future::AsyncStatus;

    use super::AppError;

    /// The recognizer ends a listen on its own after a few seconds of
    /// silence, so a listen that is still running after this long is stuck;
    /// the caller cancels it rather than hanging the mic button forever.
    const LISTEN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

    /// The in-flight recognition's cancel flag, so a second mic tap can
    /// stop it instead of stacking another listen on top. The flag — not
    /// the WinRT operation — is shared, so nothing thread-bound crosses
    /// between the listen thread and the cancel command. The generation
    /// lets a finished listen clear only its own slot.
    static IN_FLIGHT: Mutex<Option<(u64, Arc<AtomicBool>)>> = Mutex::new(None);
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    pub(super) fn cancel() {
        let Some(slot) = IN_FLIGHT.lock().ok() else {
            return;
        };
        if let Some((_, cancelled)) = slot.as_ref() {
            cancelled.store(true, Ordering::Relaxed);
        }
    }

    pub(super) async fn listen_windows(lang: Option<String>) -> Result<Option<String>, AppError> {
        let started = tokio::task::spawn_blocking(move || listen_blocking(lang));
        match tokio::time::timeout(LISTEN_TIMEOUT, started).await {
            Ok(joined) => joined.map_err(|error| {
                AppError::Internal(format!("voice recognition task failed: {error}"))
            })?,
            Err(_) => {
                cancel();
                Err(AppError::Internal(
                    "voice recognition timed out".to_string(),
                ))
            }
        }
    }

    fn listen_blocking(lang: Option<String>) -> Result<Option<String>, AppError> {
        // COM on this thread, like the volume-mixer thread does.
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| map_winrt_error(error, "initialise speech recognition"))?;
        }
        let recognizer = create_recognizer(lang.as_deref())
            .map_err(|error| map_winrt_error(error, "start the speech recognizer"))?;

        // A free-form spoken query, like Android's LANGUAGE_MODEL_FREE_FORM.
        let topic = SpeechRecognitionTopicConstraint::Create(
            SpeechRecognitionScenario::WebSearch,
            &HSTRING::from("voice-search"),
        )
        .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        let constraint: ISpeechRecognitionConstraint =
            Interface::cast::<ISpeechRecognitionConstraint>(&topic)
                .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        recognizer
            .Constraints()
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?
            .Append(&constraint)
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        let compile = recognizer
            .CompileConstraintsAsync()
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        let compiled = await_operation(&compile)
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        if compiled
            .Status()
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?
            != SpeechRecognitionResultStatus::Success
        {
            return Err(AppError::VoiceSearchUnavailable(
                "the speech recognizer could not load its grammar".to_string(),
            ));
        }

        let timeouts = recognizer
            .Timeouts()
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        timeouts
            .SetInitialSilenceTimeout(seconds(5))
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        timeouts
            .SetBabbleTimeout(seconds(10))
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;
        timeouts
            .SetEndSilenceTimeout(seconds(2))
            .map_err(|error| map_winrt_error(error, "set up the speech recognizer"))?;

        let operation = recognizer
            .RecognizeAsync()
            .map_err(|error| map_winrt_error(error, "start listening"))?;
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Ok(mut slot) = IN_FLIGHT.lock() {
            // A previous listen left its flag behind; set it so two mic
            // taps never listen at once.
            if let Some((_, previous)) = slot.replace((id, cancelled.clone())) {
                previous.store(true, Ordering::Relaxed);
            }
        }
        // Poll the operation instead of blocking on it: the cancel flag
        // is checked each round, so a second mic tap ends the listen
        // promptly without the operation ever leaving this thread.
        let status = loop {
            match operation.Status() {
                Ok(
                    status @ (AsyncStatus::Completed | AsyncStatus::Canceled | AsyncStatus::Error),
                ) => break status,
                Ok(_) => {}
                Err(error) => return Err(map_winrt_error(error, "listen")),
            }
            if cancelled.load(Ordering::Relaxed) {
                let _ = operation.Cancel();
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        if let Ok(mut slot) = IN_FLIGHT.lock() {
            if slot.as_ref().is_some_and(|(stored, _)| *stored == id) {
                slot.take();
            }
        }
        if status == AsyncStatus::Canceled {
            return Ok(None);
        }
        let result = operation
            .GetResults()
            .map_err(|error| map_winrt_error(error, "listen"))?;

        match result
            .Status()
            .map_err(|error| map_winrt_error(error, "read the recognition result"))?
        {
            SpeechRecognitionResultStatus::Success => {
                let text = result
                    .Text()
                    .map_err(|error| map_winrt_error(error, "read the recognised text"))?
                    .to_string();
                let text = text.trim().to_string();
                if text.is_empty() {
                    Err(AppError::VoiceSearchNoSpeech(
                        "the recognizer heard nothing".to_string(),
                    ))
                } else {
                    Ok(Some(text))
                }
            }
            SpeechRecognitionResultStatus::UserCanceled => Ok(None),
            SpeechRecognitionResultStatus::TimeoutExceeded
            | SpeechRecognitionResultStatus::PauseLimitExceeded => Err(
                AppError::VoiceSearchNoSpeech("no speech was recognised".to_string()),
            ),
            SpeechRecognitionResultStatus::MicrophoneUnavailable => {
                Err(AppError::VoiceSearchUnavailable(
                    "no microphone is available for speech recognition".to_string(),
                ))
            }
            status => Err(AppError::VoiceSearchUnavailable(format!(
                "recognition ended with status {status:?}"
            ))),
        }
    }

    /// Blocks until a WinRT async operation finishes and returns its
    /// result. `GetResults` on an unfinished operation fails, so the
    /// status is polled first; the caller bounds the wait.
    fn await_operation<T>(
        operation: &windows_future::IAsyncOperation<T>,
    ) -> windows::core::Result<T>
    where
        T: windows::core::RuntimeType + 'static,
    {
        loop {
            match operation.Status() {
                Ok(AsyncStatus::Completed) | Ok(AsyncStatus::Canceled) | Ok(AsyncStatus::Error) => {
                    return operation.GetResults();
                }
                Ok(_) => std::thread::sleep(std::time::Duration::from_millis(10)),
                Err(error) => return Err(error),
            }
        }
    }

    /// The requested language first, then `en-US`, then whatever the system
    /// offers: a missing language pack must not break voice search outright.
    fn create_recognizer(lang: Option<&str>) -> windows::core::Result<SpeechRecognizer> {
        let mut candidates: Vec<&str> = Vec::new();
        if let Some(lang) = lang.filter(|lang| !lang.trim().is_empty()) {
            candidates.push(lang);
        }
        candidates.push("en-US");
        let mut last_error: Option<windows::core::Error> = None;
        for candidate in candidates {
            let Ok(language) = Language::CreateLanguage(&HSTRING::from(candidate)) else {
                continue;
            };
            match SpeechRecognizer::Create(&language) {
                Ok(recognizer) => return Ok(recognizer),
                Err(error) => last_error = Some(error),
            }
        }
        match SpeechRecognizer::new() {
            Ok(recognizer) => Ok(recognizer),
            Err(error) => Err(last_error.unwrap_or(error)),
        }
    }

    /// A WinRT failure as the voice-search error it means for the user:
    /// denied microphone access stays denied, everything else is
    /// "not available".
    fn map_winrt_error(error: windows::core::Error, what: &str) -> AppError {
        if error.code() == E_ACCESSDENIED {
            AppError::VoiceSearchDenied(format!("could not {what}: {error}"))
        } else {
            AppError::VoiceSearchUnavailable(format!("could not {what}: {error}"))
        }
    }

    /// Whole seconds as a WinRT `TimeSpan` (100-nanosecond ticks).
    const fn seconds(seconds: i64) -> TimeSpan {
        TimeSpan {
            Duration: seconds * 10_000_000,
        }
    }
}
