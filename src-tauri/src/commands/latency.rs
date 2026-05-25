use serde::{Deserialize, Serialize};
use std::time::Instant;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyResult {
    pub node_id: String,
    pub latency_ms: i64, // -1 means timeout/failed
    pub status: String,  // "ok", "timeout", "error"
}

/// Test TCP connection latency to a single node (connect to server:port)
#[tauri::command]
pub async fn test_node_latency(node_id: String, server: String, port: u16) -> Result<LatencyResult, String> {
    let timeout = Duration::from_secs(5);
    let addr_str = format!("{}:{}", server, port);

    // Resolve DNS first
    let socket_addr = match addr_str.to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(addr) => addr,
            None => {
                return Ok(LatencyResult {
                    node_id,
                    latency_ms: -1,
                    status: "error".to_string(),
                });
            }
        },
        Err(_) => {
            return Ok(LatencyResult {
                node_id,
                latency_ms: -1,
                status: "error".to_string(),
            });
        }
    };

    let start = Instant::now();
    let result = TcpStream::connect_timeout(&socket_addr, timeout);
    let elapsed = start.elapsed().as_millis() as i64;

    match result {
        Ok(_stream) => Ok(LatencyResult {
            node_id,
            latency_ms: elapsed,
            status: "ok".to_string(),
        }),
        Err(_) => {
            let status = if elapsed >= 4900 { "timeout" } else { "error" };
            Ok(LatencyResult {
                node_id,
                latency_ms: -1,
                status: status.to_string(),
            })
        }
    }
}

/// Test latency for all nodes in batch
#[tauri::command]
pub async fn test_all_latency(nodes: Vec<(String, String, u16)>) -> Result<Vec<LatencyResult>, String> {
    let mut results = Vec::new();

    for (node_id, server, port) in nodes {
        let result = test_node_latency(node_id, server, port).await?;
        results.push(result);
    }

    Ok(results)
}
