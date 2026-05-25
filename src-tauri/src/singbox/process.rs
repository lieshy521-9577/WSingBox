/// Utility module for sing-box process lifecycle management.
/// This can be extended with more granular process control (e.g., graceful shutdown, restart).

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub struct ProcessManager {
    child: Mutex<Option<Child>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub fn start(&self, config_path: &str) -> Result<u32, String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;

        if guard.is_some() {
            return Err("sing-box is already running".to_string());
        }

        let child = Command::new("sing-box")
            .args(["run", "-c", config_path])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start sing-box: {}", e))?;

        let pid = child.id();
        *guard = Some(child);
        Ok(pid)
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;

        if let Some(ref mut child) = *guard {
            child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
            child.wait().ok();
            *guard = None;
            Ok(())
        } else {
            Err("sing-box is not running".to_string())
        }
    }

    pub fn is_running(&self) -> bool {
        let guard = self.child.lock().unwrap();
        guard.is_some()
    }
}
