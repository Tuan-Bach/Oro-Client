pub mod agent;
pub mod commands;
pub mod dag;
pub mod db;
pub mod scheduler;
pub mod vault;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use commands::AppState;
use db::CoworkerStore;
use scheduler::CoworkerScheduler;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize SQLite store in app data directory
            let db_path = app
                .path()
                .app_data_dir()
                .map(|p| {
                    let _ = std::fs::create_dir_all(&p);
                    p.join("oro_coworker.db").to_string_lossy().to_string()
                })
                .unwrap_or_else(|_| "oro_coworker.db".to_string());

            let store = Arc::new(Mutex::new(
                CoworkerStore::open(&db_path).expect("failed to open coworker SQLite store"),
            ));
            let scheduler = Arc::new(CoworkerScheduler::new(store.clone()));
            let initial_root = {
                let home = std::env::var("USERPROFILE")
                    .or_else(|_| std::env::var("HOME"))
                    .unwrap_or_else(|_| ".".to_string());
                let cfg_path = PathBuf::from(home).join(".oro").join("config.json");
                std::fs::read_to_string(&cfg_path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                    .and_then(|v| v["lastWorkspace"].as_str().map(PathBuf::from))
                    .filter(|p| p.exists() && p.is_dir())
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            };
            let workspace_root = Arc::new(Mutex::new(initial_root));

            let llm_client = Arc::new(crate::agent::provider::LlmClient::new());

            app.manage(AppState {
                store,
                scheduler,
                workspace_root,
                llm_client,
            });

            // ==================== SYSTEM TRAY ====================
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let open_i = MenuItem::with_id(app, "open", "Open Oro", true, None::<&str>)?;
            let shift_i = MenuItem::with_id(app, "toggle_shift", "Toggle Shift (At Desk / Away)", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Oro", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_i, &shift_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Oro — AI Second Brain")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "toggle_shift" => {
                            if let Some(state) = app.try_state::<AppState>() {
                                let cur = state.scheduler.get_shift();
                                let next = match cur {
                                    crate::scheduler::ShiftState::AtDesk => crate::scheduler::ShiftState::SteppingAway,
                                    _ => crate::scheduler::ShiftState::AtDesk,
                                };
                                state.scheduler.set_shift(next);
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Co-Worker 24/7 Commands
            commands::get_shift_status,
            commands::set_shift_status,
            commands::create_goal,
            commands::get_active_goal,
            commands::create_task,
            commands::list_tasks,
            commands::list_approvals,
            commands::resolve_approval,
            commands::get_coworker_snapshot,
            // Vault File & Knowledge Graph Commands
            commands::get_workspace_root,
            commands::set_workspace_root,
            commands::get_tree,
            commands::read_file,
            commands::read_media_data_url,
            commands::write_file,
            commands::delete_path,
            commands::move_path,
            commands::create_folder,
            commands::search_vault,
            commands::get_backlinks,
            commands::get_all_links,
            commands::get_knowledge_graph,
            commands::reindex_vault,
            // Agent & Chat Commands
            commands::send_chat_message,
            commands::cancel_chat,
            commands::list_sessions,
            commands::get_session,
            commands::create_session,
            commands::update_session,
            commands::delete_session,
            commands::list_messages,
            commands::delete_messages,
            commands::get_session_files,
            commands::set_file_pinned,
            commands::list_memories,
            commands::save_memory,
            commands::delete_memory,
            commands::list_tasks_all,
            commands::add_task,
            commands::toggle_task,
            commands::delete_task,
            commands::list_snapshots,
            commands::rollback_snapshot,
            commands::list_drafts,
            commands::get_draft,
            commands::save_draft,
            commands::delete_draft,
            commands::clear_all_drafts,
            commands::get_config,
            commands::save_config,
            commands::save_provider_key,
            commands::save_provider_model,
            commands::get_workspace_info,
            commands::get_recent_workspaces,
            // Window & Native Shell Commands
            commands::window_control,
            commands::set_zoom_factor,
            commands::select_workspace_folder,
            commands::reveal_in_explorer,
            commands::open_external,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
