mod commands;

use commands::{config, latency, proxy, singbox as singbox_cmd};
use tauri::{
    image::Image,
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

const APP_ICON: &[u8] = include_bytes!("../icons/icon.ico");
const TRAY_ICON_DISCONNECTED: &[u8] = include_bytes!("../icons/tray-disconnected.ico");
const TRAY_ICON_CONNECTED: &[u8] = include_bytes!("../icons/tray-connected.ico");

pub(crate) fn tray_icon_image(connected: bool) -> tauri::Result<Image<'static>> {
    let bytes = if connected {
        TRAY_ICON_CONNECTED
    } else {
        TRAY_ICON_DISCONNECTED
    };
    Image::from_bytes(bytes)
}

pub(crate) fn apply_tray_icon(app: &tauri::AppHandle, connected: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id("main-tray")
        .ok_or("Tray icon is not initialized".to_string())?;
    let icon =
        tray_icon_image(connected).map_err(|e| format!("Failed to load tray icon: {}", e))?;
    let tooltip = if connected {
        "SingBox Client - Connected"
    } else {
        "SingBox Client - Disconnected"
    };
    tray.set_icon(Some(icon))
        .map_err(|e| format!("Failed to update tray icon: {}", e))?;
    tray.set_tooltip(Some(tooltip))
        .map_err(|e| format!("Failed to update tray tooltip: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let icon = Image::from_bytes(APP_ICON)?;
                let _ = window.set_icon(icon);
            }

            let tray_menu = MenuBuilder::new(app)
                .text("show_window", "Show Window")
                .text("hide_window", "Hide Window")
                .separator()
                .text("quit_app", "Quit")
                .build()?;

            let icon = tray_icon_image(false)?;

            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("SingBox Client")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if let Some(window) = app.get_webview_window("main") {
                        match event.id().as_ref() {
                            "show_window" => {
                                let _ = window.set_skip_taskbar(false);
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                            "hide_window" => {
                                let _ = window.set_skip_taskbar(true);
                                let _ = window.hide();
                            }
                            "quit_app" => {
                                let _ = singbox_cmd::cleanup_before_exit();
                                app.exit(0);
                            }
                            _ => {}
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let visible = window.is_visible().unwrap_or(true);
                                if visible {
                                    let _ = window.set_skip_taskbar(true);
                                    let _ = window.hide();
                                } else {
                                    let _ = window.set_skip_taskbar(false);
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // sing-box process management
            singbox_cmd::start_singbox,
            singbox_cmd::stop_singbox,
            singbox_cmd::get_singbox_status,
            singbox_cmd::quit_application,
            singbox_cmd::hide_main_window,
            singbox_cmd::get_runtime_logs,
            singbox_cmd::clear_runtime_logs,
            singbox_cmd::set_tray_connection_state,
            // system proxy management
            proxy::set_system_proxy,
            proxy::clear_system_proxy,
            proxy::get_proxy_status,
            // configuration management
            config::get_nodes,
            config::add_node,
            config::update_node,
            config::remove_node,
            config::generate_config,
            config::import_subscription,
            config::import_config_file,
            config::import_config_url,
            config::get_config_overview,
            config::get_profiles,
            config::get_active_outbound,
            config::get_runtime_debug_snapshot,
            config::get_config_profiles,
            config::get_active_config_profile,
            config::has_imported_config,
            config::clear_config,
            config::get_app_settings,
            config::save_app_settings,
            config::get_singbox_core_version,
            config::get_rule_sets_json,
            config::save_rule_sets_json,
            config::get_route_rules_json,
            config::save_route_rules_json,
            config::set_active_outbound,
            config::remove_group,
            config::switch_config_profile,
            config::delete_config_profile,
            // latency testing
            latency::test_node_latency,
            latency::test_all_latency,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
