#![warn(clippy::all)]
#![warn(clippy::pedantic)]
#![allow(clippy::missing_errors_doc)]

pub mod api;
mod appimage;
pub mod auth;
pub mod backup;
mod bridge;
mod cache_usage;
#[cfg(target_os = "linux")]
mod codec_probe;
pub mod commands;
mod config;
pub mod data_model;
mod db;
mod errors;
#[cfg(any(target_os = "linux", test))]
mod legacy_link_handler;
#[cfg(any(target_os = "linux", test))]
mod linux_startup;
mod linux_system;
mod local_media;
#[cfg(target_os = "macos")]
mod macos_dock;
#[cfg(target_os = "macos")]
mod macos_window;
pub mod models;
mod recap;
mod relaunch;
mod scrobble;
mod security;
mod services;
mod streaming;
mod update_support;
#[cfg(any(target_os = "linux", test))]
mod web_process;
#[cfg(any(windows, test))]
mod webview2;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

use api::innertube::InnertubeClient;
use commands::account::{
    add_video_to_server_playlist, add_videos_to_server_playlist, clear_server_history,
    create_server_playlist, delete_server_playlist, get_liked_videos, get_server_history,
    get_server_home_feed, get_server_playlists, get_server_subscriptions, get_watch_later,
    merge_watch_history, remove_video_from_server_playlist, remove_videos_from_server_playlist,
    rename_server_playlist, set_channel_subscribed, set_video_disliked, set_video_liked,
    set_video_watch_later,
};
use commands::app_window::{AppWindowSession, AppWindowState, app_window_session, open_app_window};
use commands::auth::{
    add_account, cancel_google_sign_in, get_account_info, get_auth_status, list_accounts,
    remove_account, sign_out, start_google_sign_in, switch_account,
};
use commands::backup::{export_backup_data, import_backup_data};
use commands::db::{
    add_watch_record, add_watch_records_bulk, block_channel, clear_watch_history,
    delete_short_watch_records, delete_watch_record, get_music_history, get_setting,
    get_watch_history, get_watch_history_count, get_watch_history_years, get_watch_progress,
    get_watch_records, record_seen_videos, reset_app_data, restore_watch_record,
    seen_video_ids_among, set_setting, unblock_channel,
};
use commands::diagnostics::{
    clear_logs, crash_report_delete, crash_report_dismiss, crash_report_read, get_graphics_mode,
    graphics_report, linux_codec_source, log_frontend_event, logs_dir_path, read_logs,
    reset_visitor_identity, reveal_logs_folder, set_graphics_mode, startup_render_ok,
    updates_supported,
};
use commands::discord::{clear_discord_presence, set_discord_presence};
use commands::download_storage::download_storage_usage;
use commands::downloads::{
    DownloadManager, cancel_download, clear_downloads, create_download_collection,
    delete_download_collections, delete_downloads, discard_download, find_earlier_downloads,
    get_download_formats, get_download_logs, get_downloaded_video_ids, get_offline_stream,
    list_download_collections, list_downloads, pause_download, restore_downloads, resume_download,
    retag_older_downloads, retry_download, reveal_download, set_download_concurrency,
    show_download_notification, start_download,
};
use commands::external::open_external;
use commands::files::{save_recap_poster, write_backup_file, write_lyrics_file};
use commands::lyrics::{
    clear_lyrics_cache, evict_cached_lyrics, get_cached_lyrics, lyrics_cache_size,
    put_cached_lyrics, save_download_lyrics,
};
use commands::media_keys::{
    global_media_keys_set, global_media_keys_supported, system_output_watch,
};
use commands::music::{
    get_cached_music_home_page, get_liked_music, get_music_album_continuation,
    get_music_album_page, get_music_artist_items, get_music_artist_page, get_music_captions_lrc,
    get_music_charts_page, get_music_explore_page, get_music_home_page, get_music_library,
    get_music_lyrics_typed, get_music_mood_genre, get_music_mood_groups, get_music_moods,
    get_music_new_releases, get_music_playlist_continuation, get_music_playlist_page,
    get_music_queue, get_music_queue_continuation, get_music_related_typed,
    get_music_request_diagnostics, get_music_search_suggestions, get_music_search_summary,
    get_music_stream, get_music_trending_songs, get_music_watch_queue, image_proxy_base,
    lyrics_http_get, proxy_artwork_loop, proxy_image_url, romanize_lyrics,
    search_music_continuation, search_music_typed, set_music_liked, set_music_playlist_saved,
};
use commands::music_queue::{
    clear_music_queue_state, get_music_resume_position, load_music_queue_state,
    save_music_queue_state, save_music_resume_position,
};
use commands::notes::{
    delete_notes, list_notes, restore_notes, save_note, save_note_subject, save_notes_order,
};
use commands::notifications::{
    cancel_upcoming_reminder, check_subscriptions_now, clear_notifications, delete_notification,
    get_notifications, get_unread_notification_count, get_upcoming_reminders,
    mark_notification_read, restore_notification, set_upcoming_reminder,
};
#[cfg(not(target_os = "macos"))]
use commands::pip::PIP_WINDOW_LABEL;
use commands::pip::{
    PipState, close_pip_window, focus_main_window, focus_pip_source_window, open_pip_window,
    pip_session, pip_window_ready, set_pip_always_on_top,
};
use commands::process::relaunch_app;
use commands::recognition::recognize_song;
use commands::scrobble::{
    scrobble_flush, scrobble_listened, scrobble_love, scrobble_now_playing,
    scrobble_retry_keychain, scrobble_set_own_key, scrobble_sign_in, scrobble_sign_out,
    scrobble_similar_tracks, scrobble_status, scrobble_top_artists,
};
use commands::shorts::{get_shorts_feed, load_more_shorts, reset_shorts_feed};
use commands::subscription_posts::{forget_subscription_posts, get_subscription_posts};
use commands::subtitle_file::read_subtitle_file;
use commands::tray::{
    music_tray_hide, music_tray_supported, music_tray_update, set_download_progress,
    set_shell_pages, take_launch_link, take_launch_page,
};
use commands::voice_search::{voice_search_cancel, voice_search_listen};
use commands::window::{PlayerFullscreenState, set_player_fullscreen};
use commands::youtube::{
    create_comment, create_comment_reply, delete_comment, delete_live_chat_message,
    fetch_subtitles, get_channel_about, get_channel_details, get_channel_page, get_channel_tab,
    get_comments, get_dearrow_override, get_explore_destination, get_explore_grid,
    get_explore_page, get_live_chat, get_mix_playlist, get_more_related_videos,
    get_non_music_segments, get_original_title, get_paid_promotion, get_playlist_details,
    get_post_comments, get_related_videos, get_return_youtube_dislike, get_sabr_debug_state,
    get_search_suggestions, get_sponsorblock_segments, get_stream_info,
    get_subscription_rotation_feed, get_subscription_rss_feed, get_unplayable_video_ids,
    get_video_category, get_video_details, get_video_metadata, get_video_storyboard, like_comment,
    like_post, parse_subscription_export, resolve_channel_id, scan_subscription_collaborations,
    search_videos, send_live_chat_message, stream_subscription_rss_feed,
    submit_sponsorblock_segment,
};
use services::discord_presence::DiscordPresence;
use services::music_service::MusicService;
use services::shorts_service::ShortsService;
use services::youtube_service::YoutubeService;

/// Installs the global tracing subscriber: pretty logs to stdout (dev) plus a
/// rolling daily file under `<app_data_dir>/logs` so failures stay diagnosable
/// in the packaged app, where there is no terminal to read stdout from. Both
/// outputs share one `EnvFilter` (default `info`, override with `RUST_LOG`) and
/// carry module target + line number so every event points at its source.
///
/// Returns the appender's flush guard, which the caller must keep alive for the
/// process lifetime, or `None` when only stdout logging could be initialized.
/// The file mirrors the same events as stdout — it never logs secrets.
fn init_tracing(
    app_data_dir: &std::path::Path,
) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::{EnvFilter, Layer, fmt, prelude::*};

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let stdout_layer = fmt::layer().with_target(true).with_line_number(true);

    let log_dir = app_data_dir.join("logs");
    let appender = std::fs::create_dir_all(&log_dir)
        .map_err(|e| e.to_string())
        .and_then(|_| {
            tracing_appender::rolling::RollingFileAppender::builder()
                .rotation(tracing_appender::rolling::Rotation::DAILY)
                .filename_prefix("youglidetube")
                .filename_suffix("log")
                .max_log_files(7)
                .build(&log_dir)
                .map_err(|e| e.to_string())
        });

    let (file_layer, guard) = match appender {
        Ok(appender) => {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            let layer = fmt::layer()
                .with_ansi(false)
                .with_target(true)
                .with_line_number(true)
                .with_writer(writer)
                .boxed();
            (Some(layer), Some(guard))
        }
        Err(error) => {
            eprintln!("youglidetube: file logging unavailable, using stdout only: {error}");
            (None, None)
        }
    };

    tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();

    if guard.is_some() {
        tracing::info!(dir = %log_dir.display(), "file_logging_initialized");
    }
    guard
}

/// Tauri's `app_data_dir()` rule, available before the app is built.
fn app_data_dir(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(identifier))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Resolve the embedded config up front so the Linux startup workarounds can
    // key their crash sentinel to the real bundle identifier. Must run before any
    // GTK/WebKitGTK init (which happens in `.build()` below).
    let context = tauri::generate_context!();
    relaunch::capture_launch_env();
    let crash_folder = app_data_dir(context.config().identifier.as_str())
        .map(|dir| services::crash_report::folder(&dir));
    if let Some(folder) = &crash_folder {
        services::crash_report::install_hook(
            folder.clone(),
            context.package_info().version.to_string(),
        );
    }

    // Before any window opens, since the web view holds its cache while it runs.
    if let Some(dir) = app_data_dir(context.config().identifier.as_str()) {
        let cache_dirs = cache_usage::artwork_cache_dirs(
            context.config().identifier.as_str(),
            context.config().product_name.as_deref().unwrap_or_default(),
        );
        cache_usage::tidy_artwork_at_launch(&dir, &cache_dirs);
    }

    #[cfg(target_os = "linux")]
    let boot_report = linux_startup::begin(
        context.config().identifier.as_str(),
        &context.package_info().version.to_string(),
    );
    #[cfg(target_os = "linux")]
    let libva_fallback = appimage::apply_libva_fallback();

    // In-app updates run against the published release's latest.json (see
    // `plugins.updater.endpoints` in tauri.conf.json): with no endpoints
    // there is nothing to check against, so the updater plugin is never
    // registered (see below) and the About page says updates aren't set up
    // yet instead of offering a check.
    // `PluginConfig` is a map of plugin name to its JSON config, so the
    // updater entry is looked up by name: a non-empty `endpoints` array
    // means a release server is configured.
    let updater_configured = context
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("endpoints"))
        .and_then(|endpoints| endpoints.as_array())
        .is_some_and(|endpoints| !endpoints.is_empty());
    let update_support = update_support::detect(
        tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default())
            .ok()
            .as_deref(),
        updater_configured,
    );

    let mut builder = tauri::Builder::default();

    // Single-instance MUST be the first plugin. A second `youglidetube://` launch is
    // forwarded to this running window (via the "deep-link" feature) instead of
    // spawning a duplicate; we just raise the window here.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // The desktop file's "New window" action launches the app again with this flag.
            if argv.iter().any(|arg| arg == "--new-window") {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let opener = handle.get_webview_window("main");
                    let session = AppWindowSession {
                        route: "/".into(),
                        handoff: None,
                    };
                    if let Err(error) = commands::app_window::open_app_window_with(
                        &handle,
                        opener.as_ref(),
                        session,
                    ) {
                        tracing::warn!(error = ?error, "Could not open a window for --new-window");
                    }
                });
                return;
            }
            if let Some(route) = services::shell_pages::route_from_args(argv.iter()) {
                services::shell_pages::open_route(app, route);
                return;
            }
            if let Some(handoff) = services::shell_pages::link_from_args(argv.iter()) {
                services::shell_pages::open_link(app, &handoff);
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

        // Start maximized on the first launch, then restore the last normal
        // size/position and maximized state. Fullscreen is intentionally not
        // persisted because it belongs to the active video player session.
        let window_state_flags = tauri_plugin_window_state::StateFlags::SIZE
            | tauri_plugin_window_state::StateFlags::POSITION
            | tauri_plugin_window_state::StateFlags::MAXIMIZED;
        // Only the main window's place is remembered; extra windows cascade from their opener.
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags)
                .with_filter(|label| label == "main")
                .build(),
        );

        // In-app updater (GitHub releases, signature-verified) plus the process
        // plugin so the frontend can relaunch into the freshly installed build.
        // Installs that something else updates never get the updater at all.
        if update_support.supported {
            builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        }
        builder = builder.plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Microphone for Shazam-style music recognition: the recognition page
        // records 12s from the mic through getUserMedia, as Android's
        // AudioRecorder does. The webviews only ever load this app's own
        // frontend (the Google sign-in window never asks for the mic), so
        // allowing the request here only ever serves that one user action.
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Microphone => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
        .setup(move |app| {
            // Resolve the app data dir first so file logging is live before any
            // other setup step can fail — otherwise an early failure would leave
            // no trace in the packaged app.
            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    error.to_string(),
                ))
            })?;

            // Keep the file-appender flush guard alive for the app's lifetime by
            // handing it to Tauri's managed state (dropped on exit, flushing).
            if let Some(guard) = init_tracing(&app_data_dir) {
                app.manage(std::sync::Mutex::new(guard));
            }

            app.manage(services::crash_report::CrashReports::new(
                crash_folder
                    .clone()
                    .unwrap_or_else(|| services::crash_report::folder(&app_data_dir)),
            ));

            // Report which Linux GPU/Wayland workaround tier this launch applied,
            // so it appears in bug reports. `prior_failed_boots > 0` means the
            // previous launch never confirmed a render (a startup crash).
            #[cfg(target_os = "linux")]
            tracing::info!(
                tier = boot_report.tier,
                prior_failed_boots = boot_report.failed_boots,
                nvidia_preset = boot_report.nvidia_preset,
                safe_graphics = boot_report.safe_graphics,
                graphics_mode = boot_report.mode.as_str(),
                libva_fallback,
                "linux_startup_workarounds_applied"
            );

            // Probe system GStreamer decoders off-thread so a "video frozen"
            // report is diagnosable from the logs even before playback.
            #[cfg(target_os = "linux")]
            std::thread::spawn(codec_probe::log_probe);

            // Let the BotGuard minter open a hidden WebView for a real-browser
            // poToken (falls back to the headless Node sidecar without this).
            api::innertube::core::hidden_webview::set_app_handle(app.handle().clone());

            // Linux bundles keep the Node sidecar scripts in the resource dir.
            if let Ok(dir) = app.path().resource_dir() {
                api::innertube::core::botguard::set_resource_dir(dir);
            }

            // Register the app's AppUserModelID + logo so Windows attributes toasts to
            // "YouGlideTube" instead of the launching shell / PowerShell.
            #[cfg(windows)]
            services::win_notify::ensure_setup(app.handle());

            // Name the app's audio in the volume mixer instead of "Microsoft Edge WebView2".
            #[cfg(windows)]
            services::win_mixer::start(app.handle());

            api::http::warm_shared_client();

            // Initialize native Innertube extractor (shared by the video path and
            // the additive YouTube Music subsystem).
            // Google sign-in session, restored from the app-data dir so a
            // previous login survives restarts. The extractor reads it fresh
            // per request, so sign-in/out takes effect immediately.
            let google_auth = Arc::new(crate::auth::AuthSession::new(&app_data_dir));
            google_auth.restore();
            app.manage(google_auth.clone());
            let mut extractor_client = InnertubeClient::new();
            extractor_client.set_auth(google_auth.clone());
            let extractor = Arc::new(extractor_client);
            // The YouTube visitor identity lives in the app data folder; a new one is
            // fetched on first open.
            std::fs::create_dir_all(&app_data_dir)?;
            extractor.keep_identity_in(app_data_dir.join("visitor_identity.json"));
            let youtube_service = YoutubeService::new(extractor.clone());
            let link_resolver = commands::youtube::link_resolver(youtube_service.clone());
            app.manage(youtube_service);
            app.manage(extractor.clone());

            // The first video otherwise waits on both: the visitor identity every
            // player request carries, and the player script web clients need.
            let warm_extractor = extractor.clone();
            tauri::async_runtime::spawn(async move {
                warm_extractor.fetch_visitor_data().await;
                api::innertube::core::player_js::prewarm().await;
            });

            // Initialize SQLite database
            let pool =
                tauri::async_runtime::block_on(db::initialize_database(app_data_dir.clone()))
                    .map_err(|error| {
                        Box::new(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            error.to_string(),
                        ))
                    })?;

            for key in commands::db::BACKEND_SETTINGS {
                let value = tauri::async_runtime::block_on(db::settings::get_setting(&pool, key))
                    .ok()
                    .flatten();
                commands::db::apply_backend_setting(key, value.as_deref());
            }

            // Manage database pool
            app.manage(pool.clone());
            let scrobbler = Arc::new(scrobble::scrobbler::Scrobbler::new(
                pool.clone(),
                Arc::new(scrobble::credentials::keychain()),
            ));
            scrobble::worker::spawn(Arc::clone(&scrobbler));
            app.manage(scrobbler);
            app.manage(MusicService::new(extractor, pool.clone()));

            let music_pool = pool.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = db::music_content::prune(&music_pool).await {
                    tracing::warn!(%error, "Could not prune public music content graph");
                }
            });

            // Run DeArrow cache cleanup asynchronously
            let pool_clone = pool.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = db::cache::cleanup_dearrow_cache(&pool_clone).await {
                    tracing::error!("Failed to cleanup DeArrow cache: {}", e);
                }
            });

            // Manage the Shorts feed service (prefetch buffer + session de-dup)
            app.manage(ShortsService::new());
            app.manage(services::home_feed::HomeFeedService::new());
            app.manage(DownloadManager::default());
            app.manage(commands::local_media::LocalCoverLimit::default());
            let local_media_scanner = Arc::new(local_media::scanner::LocalMediaScanner::default());
            app.manage(Arc::clone(&local_media_scanner));
            local_media::scanner::scan_at_launch(
                local_media_scanner,
                app.handle().clone(),
                pool.clone(),
            );
            app.manage(PlayerFullscreenState::default());
            app.manage(PipState::default());
            app.manage(AppWindowState::default());
            app.manage(commands::theme::ThemeFileWatch::default());
            app.manage(DiscordPresence::new());
            app.manage(commands::discord::DiscordPresenceOwner::default());
            app.manage(services::music_tray::MusicTray::default());
            app.manage(services::media_keys::PlaybackTarget::default());
            app.manage(services::system_output::SystemOutputWatch::default());
            app.manage(services::shell_pages::LaunchRequest::from_args(
                services::shell_pages::lossy_args(std::env::args_os()).iter(),
            ));
            services::media_keys::watch_playback_claims(app.handle());

            // Initialize and manage streaming proxy
            let (streaming_manager, proxy_listeners) = streaming::proxy::StreamingManager::new();
            streaming_manager.set_link_resolver(link_resolver);
            tauri::async_runtime::spawn(streaming::proxy::start_proxy_server(
                streaming_manager.clone(),
                proxy_listeners.media,
            ));
            tauri::async_runtime::spawn(streaming::proxy::start_proxy_server(
                streaming_manager.clone(),
                proxy_listeners.images,
            ));
            app.manage(streaming_manager);
            app.manage(update_support);

            services::notification_service::spawn_poll_loop(app.handle().clone(), pool.clone());
            app.manage(backup::auto::AutoBackupState::default());
            backup::auto::spawn(app.handle().clone(), pool.clone());
            commands::cache::spawn_startup_trim(app.handle().clone(), pool.clone());

            // Register the youglidetube:// scheme at runtime. Installers and Linux packages
            // do this themselves; an AppImage and dev builds need it here.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            let registers_links = update_support
                .registers_link_handler(tauri::utils::platform::bundle_type().as_ref());
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            if registers_links {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register_all() {
                    tracing::warn!("failed to register youglidetube:// scheme: {error}");
                }
            }
            #[cfg(target_os = "linux")]
            if !registers_links {
                legacy_link_handler::remove_stale(app.handle());
            }

            // Raise the window when a youglidetube:// URL arrives while running; the
            // frontend's onOpenUrl listener performs the actual routing.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |_event| {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }

            #[cfg(target_os = "macos")]
            if let Some(main_window) = app.get_webview_window("main") {
                macos_window::install_close_handler(&main_window);
                macos_window::allow_full_frame_rate(&main_window);
            }

            #[cfg(target_os = "linux")]
            if let Some(main_window) = app.get_webview_window("main") {
                web_process::watch(&main_window);
            }

            // Other platforms quit with the main window, including the pop-out,
            // unless another app window is still open: then it only hides.
            #[cfg(not(target_os = "macos"))]
            if let Some(main_window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                let main = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if commands::app_window::hide_main_instead_of_closing(&main) {
                            api.prevent_close();
                            return;
                        }
                        if let Some(pip) = handle.get_webview_window(PIP_WINDOW_LABEL) {
                            let _ = pip.destroy();
                        }
                    }
                });
            }

            // Loopback bridge for the browser extension's silent handoff path.
            tauri::async_runtime::spawn(bridge::start(app.handle().clone()));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_videos,
            get_video_details,
            get_related_videos,
            get_more_related_videos,
            get_video_category,
            get_paid_promotion,
            get_video_metadata,
            get_video_storyboard,
            get_stream_info,
            get_unplayable_video_ids,
            get_channel_details,
            get_channel_page,
            get_channel_about,
            get_channel_tab,
            get_playlist_details,
            get_mix_playlist,
            get_comments,
            get_post_comments,
            create_comment,
            create_comment_reply,
            delete_comment,
            like_comment,
            like_post,
            get_live_chat,
            send_live_chat_message,
            delete_live_chat_message,
            get_explore_destination,
            get_explore_page,
            get_explore_grid,
            get_search_suggestions,
            parse_subscription_export,
            get_watch_history,
            get_watch_history_count,
            get_music_history,
            add_watch_record,
            add_watch_records_bulk,
            restore_watch_record,
            delete_watch_record,
            delete_short_watch_records,
            get_watch_records,
            get_watch_progress,
            get_watch_history_years,
            clear_watch_history,
            reset_app_data,
            get_setting,
            set_setting,
            get_auth_status,
            get_account_info,
            get_server_subscriptions,
            get_server_home_feed,
            set_channel_subscribed,
            set_video_liked,
            set_video_disliked,
            get_server_history,
            merge_watch_history,
            clear_server_history,
            get_watch_later,
            get_server_playlists,
            get_liked_videos,
            create_server_playlist,
            delete_server_playlist,
            rename_server_playlist,
            add_video_to_server_playlist,
            remove_video_from_server_playlist,
            add_videos_to_server_playlist,
            remove_videos_from_server_playlist,
            set_video_watch_later,
            start_google_sign_in,
            cancel_google_sign_in,
            sign_out,
            list_accounts,
            switch_account,
            add_account,
            remove_account,
            relaunch_app,
            write_backup_file,
            save_recap_poster,
            write_lyrics_file,
            get_cached_lyrics,
            put_cached_lyrics,
            evict_cached_lyrics,
            lyrics_cache_size,
            clear_lyrics_cache,
            save_download_lyrics,
            export_backup_data,
            commands::cache::cache_usage,
            commands::cache::clear_cache,
            commands::cache::set_cache_limit,
            download_storage_usage,
            commands::backup_files::export_backup_file,
            commands::backup_files::read_backup,
            commands::backup_files::import_other_app,
            commands::backup_files::auto_backup_register,
            commands::backup_files::auto_backup_status,
            commands::backup_files::auto_backup_run_now,
            import_backup_data,
            get_download_formats,
            start_download,
            cancel_download,
            pause_download,
            resume_download,
            retry_download,
            discard_download,
            restore_downloads,
            get_download_logs,
            set_download_concurrency,
            reveal_download,
            show_download_notification,
            list_downloads,
            find_earlier_downloads,
            retag_older_downloads,
            get_downloaded_video_ids,
            get_offline_stream,
            commands::local_media::local_media_library,
            commands::local_media::local_media_add_folder,
            commands::local_media::local_media_remove_folder,
            commands::local_media::local_media_exclude_folder,
            commands::local_media::local_media_rescan,
            commands::local_media::local_media_cancel_scan,
            commands::local_media::local_media_report_playback,
            commands::local_media::get_local_stream,
            commands::local_media::local_media_cover,
            commands::local_media::local_media_save_frame,
            commands::local_media::local_media_pick_subtitle,
            commands::local_media::local_media_trash,
            delete_downloads,
            clear_downloads,
            create_download_collection,
            list_download_collections,
            delete_download_collections,
            record_seen_videos,
            seen_video_ids_among,
            block_channel,
            unblock_channel,
            commands::recap::recap_record_batch,
            commands::recap::recap_index,
            commands::recap::recap_summary,
            commands::recap::recap_week,
            commands::home_feed::home_feed_open,
            commands::home_feed::home_feed_refresh,
            commands::home_feed::home_feed_viewport,
            commands::home_feed::home_feed_visible,
            commands::home_feed::home_feed_retry_more,
            commands::home_feed::home_feed_clear,
            commands::home_feed::home_feed_chips,
            commands::home_feed::home_chip_feed,
            commands::home_feed::record_feed_impressions,
            get_sponsorblock_segments,
            get_non_music_segments,
            submit_sponsorblock_segment,
            get_dearrow_override,
            get_original_title,
            get_return_youtube_dislike,
            get_subscription_rotation_feed,
            get_subscription_rss_feed,
            scan_subscription_collaborations,
            stream_subscription_rss_feed,
            get_subscription_posts,
            forget_subscription_posts,
            resolve_channel_id,
            fetch_subtitles,
            read_subtitle_file,
            get_sabr_debug_state,
            log_frontend_event,
            crash_report_read,
            crash_report_dismiss,
            crash_report_delete,
            read_logs,
            clear_logs,
            logs_dir_path,
            reveal_logs_folder,
            open_external,
            reset_visitor_identity,
            startup_render_ok,
            get_graphics_mode,
            set_graphics_mode,
            linux_codec_source,
            graphics_report,
            updates_supported,
            set_player_fullscreen,
            commands::window::set_window_background,
            commands::window::set_glass_theme,
            commands::app_font::save_custom_font,
            commands::app_font::read_custom_font,
            commands::theme::theme_file_state,
            commands::theme::create_theme_file,
            commands::theme::reveal_theme_file,
            commands::theme::watch_theme_file,
            // --- Pop-out (picture-in-picture) player window ---
            open_pip_window,
            open_app_window,
            app_window_session,
            pip_session,
            close_pip_window,
            set_pip_always_on_top,
            pip_window_ready,
            focus_main_window,
            focus_pip_source_window,
            // --- Shorts feed ---
            get_shorts_feed,
            load_more_shorts,
            reset_shorts_feed,
            // --- YouTube Music subsystem (additive) ---
            get_music_home_page,
            get_cached_music_home_page,
            get_music_request_diagnostics,
            get_music_trending_songs,
            get_music_explore_page,
            get_music_charts_page,
            get_music_moods,
            get_music_mood_groups,
            get_music_new_releases,
            get_music_mood_genre,
            get_music_artist_items,
            search_music_typed,
            search_music_continuation,
            get_music_search_summary,
            get_music_search_suggestions,
            get_music_album_page,
            get_music_album_continuation,
            get_music_library,
            get_liked_music,
            set_music_liked,
            set_music_playlist_saved,
            recognize_song,
            voice_search_listen,
            voice_search_cancel,
            get_music_artist_page,
            get_music_playlist_page,
            get_music_playlist_continuation,
            get_music_watch_queue,
            get_music_queue_continuation,
            get_music_queue,
            get_music_related_typed,
            get_music_lyrics_typed,
            lyrics_http_get,
            get_music_stream,
            proxy_image_url,
            proxy_artwork_loop,
            romanize_lyrics,
            get_music_captions_lrc,
            image_proxy_base,
            // --- Music queue restore and long-track resume ---
            save_music_queue_state,
            load_music_queue_state,
            clear_music_queue_state,
            save_music_resume_position,
            get_music_resume_position,
            list_notes,
            save_note,
            delete_notes,
            save_note_subject,
            save_notes_order,
            restore_notes,
            get_notifications,
            get_unread_notification_count,
            mark_notification_read,
            delete_notification,
            restore_notification,
            clear_notifications,
            get_upcoming_reminders,
            set_upcoming_reminder,
            cancel_upcoming_reminder,
            check_subscriptions_now,
            // --- Discord Rich Presence ---
            set_discord_presence,
            clear_discord_presence,
            // --- Music tray ---
            music_tray_supported,
            music_tray_update,
            set_shell_pages,
            take_launch_page,
            take_launch_link,
            set_download_progress,
            global_media_keys_supported,
            global_media_keys_set,
            system_output_watch,
            music_tray_hide,
            // --- Scrobbling ---
            scrobble_status,
            scrobble_top_artists,
            scrobble_similar_tracks,
            scrobble_sign_in,
            scrobble_sign_out,
            scrobble_set_own_key,
            scrobble_now_playing,
            scrobble_listened,
            scrobble_love,
            scrobble_flush,
            scrobble_retry_keychain
        ])
        .build(context)
        .expect("error while building the desktop app")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                macos_window::reopen(app_handle);
            }

            if let tauri::RunEvent::Exit = event {
                relaunch::on_exit(&app_handle.env());
            }
        });
}
