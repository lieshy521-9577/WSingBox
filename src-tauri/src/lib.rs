mod commands;
mod singbox;

use commands::{config, latency, proxy, singbox as singbox_cmd};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // sing-box process management
            singbox_cmd::start_singbox,
            singbox_cmd::stop_singbox,
            singbox_cmd::get_singbox_status,
            // system proxy management
            proxy::set_system_proxy,
            proxy::clear_system_proxy,
            proxy::get_proxy_status,
            // configuration management
            config::get_nodes,
            config::add_node,
            config::remove_node,
            config::generate_config,
            config::import_subscription,
            config::import_config_file,
            config::get_config_overview,
            config::get_profiles,
            config::has_imported_config,
            config::clear_config,
            // latency testing
            latency::test_node_latency,
            latency::test_all_latency,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
