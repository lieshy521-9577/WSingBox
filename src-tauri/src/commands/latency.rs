use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyResult {
    pub node_id: String,
    pub latency_ms: i64,
    pub status: String,
}

#[tauri::command]
pub async fn test_node_latency(
    node_id: String,
    node_type: String,
    server: String,
    port: u16,
    settings: serde_json::Value,
    mode: Option<String>,
) -> Result<LatencyResult, String> {
    let mode = mode.unwrap_or_else(|| "connect".to_string());
    if mode == "connect" {
        return measure_tcp_connect(&node_id, &server, port);
    }

    let mixed_port = reserve_local_port()?;
    let config_path =
        write_temp_latency_config(&node_id, &node_type, &server, port, &settings, mixed_port)?;
    let singbox_path = find_singbox_binary()?;

    let mut child = start_temp_singbox(&singbox_path, &config_path)?;
    let proxy_ready = wait_for_port(mixed_port, Duration::from_secs(5));

    let result = if proxy_ready {
        measure_proxy_request(&node_id, mixed_port).await
    } else {
        Ok(LatencyResult {
            node_id,
            latency_ms: -1,
            status: "timeout".to_string(),
        })
    };

    stop_child(&mut child);
    let _ = fs::remove_file(&config_path);

    result
}

#[tauri::command]
pub async fn test_all_latency(
    nodes: Vec<(
        String,
        String,
        String,
        u16,
        serde_json::Value,
        Option<String>,
    )>,
) -> Result<Vec<LatencyResult>, String> {
    let mut results = Vec::new();

    for (node_id, node_type, server, port, settings, mode) in nodes {
        let result = test_node_latency(node_id, node_type, server, port, settings, mode).await?;
        results.push(result);
    }

    Ok(results)
}

fn measure_tcp_connect(node_id: &str, server: &str, port: u16) -> Result<LatencyResult, String> {
    let addr = format!("{}:{}", server, port);
    let target = addr
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve node address '{}': {}", addr, e))?
        .next()
        .ok_or_else(|| format!("No socket address resolved for '{}'", addr))?;

    let started = Instant::now();
    match TcpStream::connect_timeout(&target, Duration::from_secs(5)) {
        Ok(_) => Ok(LatencyResult {
            node_id: node_id.to_string(),
            latency_ms: started.elapsed().as_millis() as i64,
            status: "ok".to_string(),
        }),
        Err(err) if err.kind() == std::io::ErrorKind::TimedOut => Ok(LatencyResult {
            node_id: node_id.to_string(),
            latency_ms: -1,
            status: "timeout".to_string(),
        }),
        Err(_) => Ok(LatencyResult {
            node_id: node_id.to_string(),
            latency_ms: -1,
            status: "error".to_string(),
        }),
    }
}

fn reserve_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to reserve local port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get reserved port: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

fn write_temp_latency_config(
    node_id: &str,
    node_type: &str,
    server: &str,
    port: u16,
    settings: &serde_json::Value,
    mixed_port: u16,
) -> Result<PathBuf, String> {
    let mut outbound = serde_json::json!({
        "type": node_type,
        "tag": "proxy",
        "server": server,
        "server_port": port,
    });

    if let serde_json::Value::Object(extra) = settings {
        if let serde_json::Value::Object(ref mut outbound_obj) = outbound {
            for (key, value) in extra {
                outbound_obj.insert(key.clone(), value.clone());
            }
        }
    }

    let config = serde_json::json!({
        "log": { "level": "error", "timestamp": true },
        "inbounds": [{
            "type": "mixed",
            "tag": "mixed-in",
            "listen": "127.0.0.1",
            "listen_port": mixed_port
        }],
        "outbounds": [
            outbound,
            { "type": "direct", "tag": "direct" },
            { "type": "block", "tag": "block" }
        ],
        "route": { "final": "proxy" }
    });

    let dir = std::env::temp_dir().join("singbox-client-latency");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create latency temp directory: {}", e))?;
    let path = dir.join(format!("{}.json", node_id));
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize latency config: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write latency config: {}", e))?;
    Ok(path)
}

fn start_temp_singbox(singbox_path: &str, config_path: &PathBuf) -> Result<Child, String> {
    let mut command = hidden_command(singbox_path);
    super::singbox::apply_deprecated_envs(&mut command)
        .args(["run", "-c", &config_path.to_string_lossy()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start temp sing-box for latency test: {}", e))
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    false
}

async fn measure_proxy_request(node_id: &str, mixed_port: u16) -> Result<LatencyResult, String> {
    let proxy_url = format!("http://127.0.0.1:{}", mixed_port);
    let ps_script = format!(
        "$ProgressPreference='SilentlyContinue'; \
        $sw=[System.Diagnostics.Stopwatch]::StartNew(); \
        try {{ \
          $resp=Invoke-WebRequest -Uri 'https://www.gstatic.com/generate_204' -Proxy '{proxy}' -TimeoutSec 8 -UseBasicParsing; \
          $sw.Stop(); \
          if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {{ Write-Output ('OK:' + $sw.ElapsedMilliseconds) }} \
          else {{ Write-Output 'ERR' }} \
        }} catch [System.TimeoutException] {{ \
          $sw.Stop(); Write-Output 'TIMEOUT' \
        }} catch {{ \
          $sw.Stop(); Write-Output 'ERR' \
        }}",
        proxy = proxy_url
    );

    let output = hidden_command("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to run latency request via proxy: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if let Some(value) = stdout.strip_prefix("OK:") {
        let latency_ms = value.trim().parse::<i64>().unwrap_or(-1);
        return Ok(LatencyResult {
            node_id: node_id.to_string(),
            latency_ms,
            status: "ok".to_string(),
        });
    }

    if stdout.contains("TIMEOUT") {
        return Ok(LatencyResult {
            node_id: node_id.to_string(),
            latency_ms: -1,
            status: "timeout".to_string(),
        });
    }

    Ok(LatencyResult {
        node_id: node_id.to_string(),
        latency_ms: -1,
        status: "error".to_string(),
    })
}

fn stop_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn find_singbox_binary() -> Result<String, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = vec![
                exe_dir.join("sing-box.exe"),
                exe_dir.join("bin").join("sing-box.exe"),
                exe_dir.join("resources").join("sing-box.exe"),
                exe_dir.join("resources").join("bin").join("sing-box.exe"),
                exe_dir
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("bin")
                    .join("sing-box.exe"),
                exe_dir
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("bin")
                    .join("sing-box.exe"),
            ];

            for candidate in candidates {
                if candidate.exists() {
                    let path = candidate
                        .canonicalize()
                        .unwrap_or(candidate)
                        .to_string_lossy()
                        .to_string();
                    let path = path.strip_prefix(r"\\?\").unwrap_or(&path).to_string();
                    return Ok(path);
                }
            }
        }
    }

    if let Ok(output) = hidden_command("where").arg("sing-box").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path.lines().next().unwrap_or(&path).to_string());
            }
        }
    }

    let dev_path = PathBuf::from(r"C:\_dCode\SingBox\bin\sing-box.exe");
    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err("sing-box.exe not found. Please place it in the bin/ folder or add it to PATH.".to_string())
}

fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
