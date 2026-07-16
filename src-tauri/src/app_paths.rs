use std::fs;
use std::path::PathBuf;

pub fn app_data_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    let config_dir = home.join(".singbox-client");
    fs::create_dir_all(&config_dir).ok();
    config_dir
}

pub fn runtime_config_path() -> PathBuf {
    app_data_dir().join("config.json")
}

pub fn runtime_bootstrap_config_path() -> PathBuf {
    app_data_dir().join("config.bootstrap.json")
}

pub fn runtime_launch_config_path() -> PathBuf {
    app_data_dir().join("config.launch.json")
}

pub fn runtime_log_path() -> PathBuf {
    app_data_dir().join("singbox-runtime.log")
}

pub fn runtime_cache_path() -> PathBuf {
    app_data_dir().join("cache.db")
}

pub fn proxy_state_path() -> PathBuf {
    app_data_dir().join("proxy-state.json")
}

pub fn core_pid_path() -> PathBuf {
    app_data_dir().join("singbox.pid")
}

pub fn core_state_path() -> PathBuf {
    app_data_dir().join("singbox-state.json")
}

pub fn profiles_store_dir() -> PathBuf {
    let dir = app_data_dir().join("profiles-store");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn settings_file_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

pub fn config_profiles_file_path() -> PathBuf {
    app_data_dir().join("config-profiles.json")
}

pub fn active_profile_file_path() -> PathBuf {
    app_data_dir().join("active-profile.txt")
}

pub fn nodes_file_path() -> PathBuf {
    app_data_dir().join("nodes.json")
}

pub fn profiles_file_path() -> PathBuf {
    app_data_dir().join("profiles.json")
}
