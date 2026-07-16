use crate::{app_paths, core_process};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, State};
use tokio::sync::watch;
use tokio::task::JoinSet;
use uuid::Uuid;

const DEFAULT_TEST_URL: &str = "https://www.gstatic.com/generate_204";
const MANUAL_PROFILE_ID: &str = "__manual__";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyBatchRequest {
    pub profile_id: String,
    #[serde(default)]
    pub node_ids: Vec<String>,
    #[serde(default)]
    pub mode: LatencyTestMode,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LatencyTestMode {
    QuickAuto,
    #[default]
    Accurate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyResult {
    pub profile_id: String,
    pub node_id: String,
    pub delay_ms: i64,
    pub samples_ms: Vec<u64>,
    pub jitter_ms: Option<u64>,
    pub status: String,
    pub error_kind: Option<String>,
    pub tested_at: u64,
    pub endpoint: String,
    pub source: String,
    pub config_fingerprint: String,
    pub stage: String,
    pub sample_count: usize,
    pub sample_target: usize,
    #[serde(rename = "final")]
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyBatchSnapshot {
    pub run_id: String,
    pub profile_id: String,
    pub state: String,
    pub completed: usize,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub results: Vec<LatencyResult>,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LatencyTestProgress {
    run_id: String,
    profile_id: String,
    state: String,
    completed: usize,
    total: usize,
    succeeded: usize,
    failed: usize,
    result: Option<LatencyResult>,
    stage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityResult {
    pub node_id: String,
    pub connect_ms: i64,
    pub status: String,
    pub error_kind: Option<String>,
}

#[derive(Debug, Clone)]
struct TestOptions {
    url: String,
    timeout_ms: u64,
    concurrency: usize,
}

#[derive(Debug, Clone)]
struct NodeSampleState {
    node_id: String,
    samples: Vec<u64>,
    last_error: Option<String>,
}

impl NodeSampleState {
    fn new(node_id: String) -> Self {
        Self {
            node_id,
            samples: Vec::new(),
            last_error: None,
        }
    }

    fn record(&mut self, result: Result<u64, String>) {
        match result {
            Ok(delay) => self.samples.push(delay),
            Err(kind) => self.last_error = Some(kind),
        }
    }
}

#[derive(Debug, Clone)]
struct ApiEndpoint {
    base_url: String,
    secret: String,
    source: String,
}

struct ProbeResources {
    child: Child,
    dir: PathBuf,
}

struct ActiveTest {
    run_id: String,
    cancel_tx: watch::Sender<bool>,
    probe: Arc<Mutex<Option<ProbeResources>>>,
}

#[derive(Default)]
pub struct LatencyManager {
    active: Mutex<Option<ActiveTest>>,
}

impl Drop for LatencyManager {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(test) = active.take() {
                let _ = test.cancel_tx.send(true);
                cleanup_probe(&test.probe);
            }
        }
    }
}

pub struct PreparedLaunchConfig {
    pub path: PathBuf,
    pub api: core_process::CoreApiMetadata,
}

pub fn prepare_runtime_launch_config(source_path: &Path) -> Result<PreparedLaunchConfig, String> {
    let content = fs::read_to_string(source_path)
        .map_err(|e| format!("Failed to read runtime config for launch: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse runtime config for launch: {}", e))?;
    let profile_id = fs::read_to_string(app_paths::active_profile_file_path())
        .unwrap_or_default()
        .trim()
        .to_string();
    let profile_id = if profile_id.is_empty() {
        MANUAL_PROFILE_ID.to_string()
    } else {
        profile_id
    };
    let port = reserve_local_port()?;
    let secret = Uuid::new_v4().simple().to_string();
    inject_clash_api(&mut config, port, &secret)?;
    inject_rule_set_cache(&mut config, &profile_id)?;

    let path = app_paths::runtime_launch_config_path();
    let launch_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize runtime launch config: {}", e))?;
    fs::write(&path, launch_content)
        .map_err(|e| format!("Failed to write runtime launch config: {}", e))?;

    let config_fingerprint = if profile_id.is_empty() {
        config_fingerprint(&content)
    } else {
        fs::read_to_string(app_paths::profiles_store_dir().join(format!("{}.json", profile_id)))
            .map(|saved| config_fingerprint(&saved))
            .unwrap_or_else(|_| config_fingerprint(&content))
    };
    Ok(PreparedLaunchConfig {
        path,
        api: core_process::CoreApiMetadata {
            clash_api_url: format!("http://127.0.0.1:{}", port),
            clash_api_secret: secret,
            profile_id,
            config_fingerprint,
        },
    })
}

#[tauri::command]
pub async fn start_latency_test(
    app_handle: tauri::AppHandle,
    manager: State<'_, LatencyManager>,
    request: LatencyBatchRequest,
) -> Result<LatencyBatchSnapshot, String> {
    cancel_active_test(&manager);

    let options = load_test_options();
    let (config, config_fingerprint) = load_profile_config(&request.profile_id)?;
    let node_ids = resolve_node_ids(&config, &request.node_ids);
    let total = node_ids.len();
    let run_id = Uuid::new_v4().to_string();
    if total == 0 {
        return Ok(LatencyBatchSnapshot {
            run_id,
            profile_id: request.profile_id,
            state: "completed".to_string(),
            completed: 0,
            total: 0,
            succeeded: 0,
            failed: 0,
            results: Vec::new(),
            stage: "completed".to_string(),
        });
    }

    let (cancel_tx, cancel_rx) = watch::channel(false);
    let probe = Arc::new(Mutex::new(None));
    {
        let mut active = manager
            .active
            .lock()
            .map_err(|_| "Latency state is unavailable")?;
        *active = Some(ActiveTest {
            run_id: run_id.clone(),
            cancel_tx,
            probe: Arc::clone(&probe),
        });
    }

    let endpoint = match runtime_api_endpoint(&request.profile_id, &config_fingerprint).await {
        Some(endpoint) => endpoint,
        None => match start_probe_core(&config, &request.profile_id, &config_fingerprint, &probe)
            .await
        {
            Ok(endpoint) => endpoint,
            Err(error) => {
                if let Ok(mut active) = manager.active.lock() {
                    if active.as_ref().map(|item| item.run_id.as_str()) == Some(run_id.as_str()) {
                        *active = None;
                    }
                }
                return Err(error);
            }
        },
    };

    let initial_stage = match request.mode {
        LatencyTestMode::QuickAuto => "quick",
        LatencyTestMode::Accurate => "confirmed",
    };
    emit_progress(
        &app_handle,
        &run_id,
        &request.profile_id,
        "running",
        0,
        total,
        0,
        0,
        None,
        initial_stage,
    );

    let semaphore = Arc::new(tokio::sync::Semaphore::new(options.concurrency));
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(options.timeout_ms))
        .build()
        .map_err(|e| format!("Failed to create latency HTTP client: {}", e))?;

    let mut states: HashMap<String, NodeSampleState> = node_ids
        .iter()
        .cloned()
        .map(|node_id| (node_id.clone(), NodeSampleState::new(node_id)))
        .collect();
    let mut latest_results: HashMap<String, LatencyResult> = HashMap::new();

    match request.mode {
        LatencyTestMode::QuickAuto => {
            run_quick_stage(
                &app_handle,
                &manager,
                &run_id,
                &request.profile_id,
                &node_ids,
                &mut states,
                &client,
                &endpoint,
                &options,
                &semaphore,
                &cancel_rx,
                &config_fingerprint,
            )
            .await;

            for node_id in &node_ids {
                if let Some(state) = states.get(node_id) {
                    latest_results.insert(
                        node_id.clone(),
                        build_latency_result(
                            state,
                            &request.profile_id,
                            &endpoint,
                            &options,
                            &config_fingerprint,
                            1,
                            1,
                            "quick",
                            true,
                        ),
                    );
                }
            }

            if !*cancel_rx.borrow() {
                let candidates = select_confirmation_candidates(&latest_results, &node_ids);
                if !candidates.is_empty() {
                    emit_progress(
                        &app_handle,
                        &run_id,
                        &request.profile_id,
                        "running",
                        0,
                        candidates.len(),
                        0,
                        0,
                        None,
                        "confirmed",
                    );
                    for result in run_confirmation_stage(
                        &app_handle,
                        &manager,
                        &run_id,
                        &request.profile_id,
                        &candidates,
                        &mut states,
                        2,
                        &client,
                        &endpoint,
                        &options,
                        &semaphore,
                        &cancel_rx,
                        &config_fingerprint,
                    )
                    .await
                    {
                        latest_results.insert(result.node_id.clone(), result);
                    }
                }
            }
        }
        LatencyTestMode::Accurate => {
            for result in run_confirmation_stage(
                &app_handle,
                &manager,
                &run_id,
                &request.profile_id,
                &node_ids,
                &mut states,
                3,
                &client,
                &endpoint,
                &options,
                &semaphore,
                &cancel_rx,
                &config_fingerprint,
            )
            .await
            {
                latest_results.insert(result.node_id.clone(), result);
            }
        }
    }

    let cancelled = *cancel_rx.borrow();
    cleanup_probe(&probe);
    let should_emit_final = is_active_run(&manager, &run_id);
    if let Ok(mut active) = manager.active.lock() {
        if active.as_ref().map(|item| item.run_id.as_str()) == Some(run_id.as_str()) {
            *active = None;
        }
    }
    let state = if cancelled { "cancelled" } else { "completed" };
    let results: Vec<LatencyResult> = node_ids
        .iter()
        .filter_map(|node_id| latest_results.get(node_id).cloned())
        .collect();
    let completed = results.len();
    let succeeded = results.iter().filter(|item| item.status == "ok").count();
    let failed = results
        .iter()
        .filter(|item| item.status != "ok" && item.status != "cancelled")
        .count();
    if should_emit_final {
        emit_progress(
            &app_handle,
            &run_id,
            &request.profile_id,
            state,
            completed,
            total,
            succeeded,
            failed,
            None,
            "completed",
        );
    }

    Ok(LatencyBatchSnapshot {
        run_id,
        profile_id: request.profile_id,
        state: state.to_string(),
        completed,
        total,
        succeeded,
        failed,
        results,
        stage: "completed".to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_quick_stage(
    app: &tauri::AppHandle,
    manager: &LatencyManager,
    run_id: &str,
    profile_id: &str,
    node_ids: &[String],
    states: &mut HashMap<String, NodeSampleState>,
    client: &reqwest::Client,
    endpoint: &ApiEndpoint,
    options: &TestOptions,
    semaphore: &Arc<tokio::sync::Semaphore>,
    cancel_rx: &watch::Receiver<bool>,
    config_fingerprint: &str,
) {
    let mut tasks = JoinSet::new();
    for node_id in node_ids {
        let node_id = node_id.clone();
        let client = client.clone();
        let endpoint = endpoint.clone();
        let options = options.clone();
        let semaphore = Arc::clone(semaphore);
        let cancel_rx = cancel_rx.clone();
        tasks.spawn(async move {
            let mut state = NodeSampleState::new(node_id.clone());
            let first = sample_once(
                &client,
                &endpoint,
                &node_id,
                &options,
                Arc::clone(&semaphore),
                cancel_rx.clone(),
            )
            .await;
            let retry = first
                .as_ref()
                .err()
                .map(|kind| kind != "cancelled")
                .unwrap_or(false);
            state.record(first);
            if retry {
                state.record(
                    sample_once(
                        &client,
                        &endpoint,
                        &node_id,
                        &options,
                        semaphore,
                        cancel_rx,
                    )
                    .await,
                );
            }
            state
        });
    }

    let mut completed = 0;
    let mut succeeded = 0;
    let mut failed = 0;
    while let Some(joined) = tasks.join_next().await {
        let Ok(state) = joined else { continue };
        if !is_active_run(manager, run_id) {
            continue;
        }
        let result = build_latency_result(
            &state,
            profile_id,
            endpoint,
            options,
            config_fingerprint,
            1,
            1,
            "quick",
            true,
        );
        completed += 1;
        if result.status == "ok" {
            succeeded += 1;
        } else if result.status != "cancelled" {
            failed += 1;
        }
        states.insert(state.node_id.clone(), state);
        emit_progress(
            app,
            run_id,
            profile_id,
            "running",
            completed,
            node_ids.len(),
            succeeded,
            failed,
            Some(result),
            "quick",
        );
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_confirmation_stage(
    app: &tauri::AppHandle,
    manager: &LatencyManager,
    run_id: &str,
    profile_id: &str,
    node_ids: &[String],
    states: &mut HashMap<String, NodeSampleState>,
    rounds: usize,
    client: &reqwest::Client,
    endpoint: &ApiEndpoint,
    options: &TestOptions,
    semaphore: &Arc<tokio::sync::Semaphore>,
    cancel_rx: &watch::Receiver<bool>,
    config_fingerprint: &str,
) -> Vec<LatencyResult> {
    let mut finalized = HashSet::new();
    let mut results = Vec::new();
    let mut succeeded = 0;
    let mut failed = 0;

    for round in 0..rounds {
        if *cancel_rx.borrow() {
            break;
        }
        let active_ids: Vec<String> = node_ids
            .iter()
            .filter(|node_id| !finalized.contains(*node_id))
            .cloned()
            .collect();
        let mut tasks = JoinSet::new();
        for node_id in active_ids {
            let client = client.clone();
            let endpoint = endpoint.clone();
            let options = options.clone();
            let semaphore = Arc::clone(semaphore);
            let cancel_rx = cancel_rx.clone();
            tasks.spawn(async move {
                let result = sample_once(
                    &client,
                    &endpoint,
                    &node_id,
                    &options,
                    semaphore,
                    cancel_rx,
                )
                .await;
                (node_id, result)
            });
        }

        while let Some(joined) = tasks.join_next().await {
            let Ok((node_id, sample)) = joined else {
                continue;
            };
            let Some(state) = states.get_mut(&node_id) else {
                continue;
            };
            state.record(sample);
            if *cancel_rx.borrow() || !is_active_run(manager, run_id) {
                continue;
            }
            let remaining = rounds - round - 1;
            let cannot_reach_two_successes =
                cannot_reach_required_successes(state.samples.len(), remaining, 2);
            if remaining == 0 || cannot_reach_two_successes {
                finalized.insert(node_id.clone());
                let result = build_latency_result(
                    state,
                    profile_id,
                    endpoint,
                    options,
                    config_fingerprint,
                    2,
                    3,
                    "confirmed",
                    true,
                );
                if result.status == "ok" {
                    succeeded += 1;
                } else {
                    failed += 1;
                }
                emit_progress(
                    app,
                    run_id,
                    profile_id,
                    "running",
                    finalized.len(),
                    node_ids.len(),
                    succeeded,
                    failed,
                    Some(result.clone()),
                    "confirmed",
                );
                results.push(result);
            }
        }
    }

    results
}

async fn sample_once(
    client: &reqwest::Client,
    endpoint: &ApiEndpoint,
    node_id: &str,
    options: &TestOptions,
    semaphore: Arc<tokio::sync::Semaphore>,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<u64, String> {
    if *cancel_rx.borrow() {
        return Err("cancelled".to_string());
    }
    let permit = tokio::select! {
        changed = cancel_rx.changed() => {
            let _ = changed;
            return Err("cancelled".to_string());
        }
        permit = semaphore.acquire_owned() => permit.map_err(|_| "cancelled".to_string())?,
    };
    let _permit = permit;
    if *cancel_rx.borrow() {
        return Err("cancelled".to_string());
    }
    tokio::select! {
        changed = cancel_rx.changed() => {
            let _ = changed;
            Err("cancelled".to_string())
        }
        result = proxy_delay_request(client, endpoint, node_id, options) => result,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_latency_result(
    state: &NodeSampleState,
    profile_id: &str,
    endpoint: &ApiEndpoint,
    options: &TestOptions,
    config_fingerprint: &str,
    required_successes: usize,
    sample_target: usize,
    stage: &str,
    is_final: bool,
) -> LatencyResult {
    let mut samples = state.samples.clone();
    samples.sort_unstable();
    if samples.len() >= required_successes {
        let delay = samples[samples.len() / 2];
        let jitter = samples
            .last()
            .zip(samples.first())
            .map(|(max, min)| max - min);
        LatencyResult {
            profile_id: profile_id.to_string(),
            node_id: state.node_id.clone(),
            delay_ms: delay as i64,
            sample_count: samples.len(),
            samples_ms: samples,
            jitter_ms: jitter,
            status: "ok".to_string(),
            error_kind: state.last_error.as_ref().map(|_| "partial".to_string()),
            tested_at: current_unix_timestamp(),
            endpoint: options.url.clone(),
            source: endpoint.source.clone(),
            config_fingerprint: config_fingerprint.to_string(),
            stage: stage.to_string(),
            sample_target,
            is_final,
        }
    } else {
        let kind = state.last_error.as_deref().unwrap_or("network");
        LatencyResult {
            profile_id: profile_id.to_string(),
            node_id: state.node_id.clone(),
            delay_ms: -1,
            sample_count: samples.len(),
            samples_ms: samples,
            jitter_ms: None,
            status: if kind == "cancelled" {
                "cancelled"
            } else if kind == "timeout" {
                "timeout"
            } else {
                "error"
            }
            .to_string(),
            error_kind: Some(kind.to_string()),
            tested_at: current_unix_timestamp(),
            endpoint: options.url.clone(),
            source: endpoint.source.clone(),
            config_fingerprint: config_fingerprint.to_string(),
            stage: stage.to_string(),
            sample_target,
            is_final,
        }
    }
}

fn select_confirmation_candidates(
    results: &HashMap<String, LatencyResult>,
    node_order: &[String],
) -> Vec<String> {
    let mut healthy: Vec<&LatencyResult> = node_order
        .iter()
        .filter_map(|node_id| results.get(node_id))
        .filter(|result| result.status == "ok")
        .collect();
    healthy.sort_by_key(|result| result.delay_ms);
    if healthy.len() <= 5 {
        return healthy
            .into_iter()
            .map(|result| result.node_id.clone())
            .collect();
    }
    let best = healthy[0].delay_ms;
    let threshold = (best + 150).max((best * 3 + 1) / 2);
    healthy
        .into_iter()
        .enumerate()
        .filter(|(index, result)| *index < 5 || result.delay_ms <= threshold)
        .map(|(_, result)| result.node_id.clone())
        .collect()
}

fn cannot_reach_required_successes(
    successful_samples: usize,
    remaining_samples: usize,
    required_successes: usize,
) -> bool {
    successful_samples + remaining_samples < required_successes
}

#[tauri::command]
pub async fn cancel_latency_test(
    manager: State<'_, LatencyManager>,
    run_id: String,
) -> Result<bool, String> {
    let active = manager
        .active
        .lock()
        .map_err(|_| "Latency state is unavailable")?;
    let Some(active) = active.as_ref() else {
        return Ok(false);
    };
    if !run_id.is_empty() && active.run_id != run_id {
        return Ok(false);
    }
    let _ = active.cancel_tx.send(true);
    kill_probe(&active.probe);
    Ok(true)
}

#[tauri::command]
pub async fn test_node_connectivity(
    node_id: String,
    server: String,
    port: u16,
) -> Result<ConnectivityResult, String> {
    let started = std::time::Instant::now();
    let addresses = tokio::net::lookup_host((server.as_str(), port))
        .await
        .map_err(|e| format!("Failed to resolve '{}:{}': {}", server, port, e))?;
    let mut timed_out = false;
    for address in addresses {
        match tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::TcpStream::connect(address),
        )
        .await
        {
            Ok(Ok(_)) => {
                return Ok(ConnectivityResult {
                    node_id,
                    connect_ms: started.elapsed().as_millis() as i64,
                    status: "ok".to_string(),
                    error_kind: None,
                });
            }
            Err(_) => timed_out = true,
            Ok(Err(_)) => {}
        }
    }
    Ok(ConnectivityResult {
        node_id,
        connect_ms: -1,
        status: if timed_out { "timeout" } else { "error" }.to_string(),
        error_kind: Some(if timed_out { "timeout" } else { "connect" }.to_string()),
    })
}

fn cancel_active_test(manager: &LatencyManager) {
    if let Ok(mut active) = manager.active.lock() {
        if let Some(previous) = active.take() {
            let _ = previous.cancel_tx.send(true);
            kill_probe(&previous.probe);
        }
    }
}

fn is_active_run(manager: &LatencyManager, run_id: &str) -> bool {
    manager
        .active
        .lock()
        .ok()
        .and_then(|active| active.as_ref().map(|item| item.run_id == run_id))
        .unwrap_or(false)
}

fn load_test_options() -> TestOptions {
    let settings = super::config::load_app_settings_or_default();
    let configured_url = settings.latency_test_url.trim();
    let url = reqwest::Url::parse(configured_url)
        .ok()
        .filter(|value| matches!(value.scheme(), "http" | "https"))
        .map(|value| value.to_string())
        .unwrap_or_else(|| DEFAULT_TEST_URL.to_string());
    TestOptions {
        url,
        timeout_ms: settings.latency_timeout_ms.clamp(1_000, 30_000),
        concurrency: (settings.latency_concurrency as usize).clamp(1, 32),
    }
}

fn load_profile_config(profile_id: &str) -> Result<(serde_json::Value, String), String> {
    if profile_id.trim().is_empty() {
        return Err("No active profile selected".to_string());
    }
    if profile_id == MANUAL_PROFILE_ID {
        if let Ok(content) = fs::read_to_string(app_paths::runtime_config_path()) {
            let config = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse manual runtime config: {}", e))?;
            return Ok((config, config_fingerprint(&content)));
        }
        return load_manual_nodes_config();
    }
    let path = app_paths::profiles_store_dir().join(format!("{}.json", profile_id));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read profile for latency test: {}", e))?;
    let config = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse profile for latency test: {}", e))?;
    Ok((config, config_fingerprint(&content)))
}

fn load_manual_nodes_config() -> Result<(serde_json::Value, String), String> {
    let content = fs::read_to_string(app_paths::nodes_file_path())
        .map_err(|e| format!("Failed to read manual nodes: {}", e))?;
    let nodes: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse manual nodes: {}", e))?;
    let mut outbounds = Vec::new();
    for node in nodes.as_array().into_iter().flatten() {
        let mut outbound = serde_json::Map::new();
        outbound.insert(
            "type".to_string(),
            node.get("node_type")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
        outbound.insert(
            "tag".to_string(),
            node.get("id").cloned().unwrap_or(serde_json::Value::Null),
        );
        outbound.insert(
            "server".to_string(),
            node.get("server")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        );
        outbound.insert(
            "server_port".to_string(),
            node.get("port").cloned().unwrap_or(serde_json::Value::Null),
        );
        if let Some(settings) = node.get("settings").and_then(|value| value.as_object()) {
            for (key, value) in settings {
                outbound.insert(key.clone(), value.clone());
            }
        }
        outbounds.push(serde_json::Value::Object(outbound));
    }
    let config = serde_json::json!({ "outbounds": outbounds });
    let serialized = serde_json::to_string(&config)
        .map_err(|e| format!("Failed to serialize manual node config: {}", e))?;
    Ok((config, config_fingerprint(&serialized)))
}

fn resolve_node_ids(config: &serde_json::Value, requested: &[String]) -> Vec<String> {
    let valid_tags: HashSet<String> = config
        .get("outbounds")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter(|outbound| {
            !matches!(
                outbound
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default(),
                "direct" | "block" | "dns" | "selector" | "urltest"
            )
        })
        .filter_map(|outbound| {
            outbound
                .get("tag")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .collect();
    let source: Vec<String> = if requested.is_empty() {
        valid_tags.iter().cloned().collect()
    } else {
        requested
            .iter()
            .filter(|tag| valid_tags.contains(*tag))
            .cloned()
            .collect()
    };
    let mut seen = HashSet::new();
    source
        .into_iter()
        .filter(|tag| seen.insert(tag.clone()))
        .collect()
}

async fn runtime_api_endpoint(profile_id: &str, config_fingerprint: &str) -> Option<ApiEndpoint> {
    let state = core_process::load_core_state().ok().flatten()?;
    if state.profile_id != profile_id
        || state.config_fingerprint != config_fingerprint
        || state.clash_api_url.is_empty()
    {
        return None;
    }
    let endpoint = ApiEndpoint {
        base_url: state.clash_api_url,
        secret: state.clash_api_secret,
        source: "runtime".to_string(),
    };
    if api_ready(&endpoint, Duration::from_secs(1)).await {
        Some(endpoint)
    } else {
        None
    }
}

async fn start_probe_core(
    source: &serde_json::Value,
    _profile_id: &str,
    _config_fingerprint: &str,
    probe_slot: &Arc<Mutex<Option<ProbeResources>>>,
) -> Result<ApiEndpoint, String> {
    let port = reserve_local_port()?;
    let secret = Uuid::new_v4().simple().to_string();
    let config = build_probe_config(source, port, &secret)?;

    let dir = std::env::temp_dir().join(format!("singbox-client-latency-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create probe directory: {}", e))?;
    let config_path = dir.join("probe.json");
    let log_path = dir.join("probe.log");
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize probe config: {}", e))?;
    fs::write(&config_path, content).map_err(|e| format!("Failed to write probe config: {}", e))?;

    let log = File::create(&log_path).map_err(|e| format!("Failed to create probe log: {}", e))?;
    let log_err = log
        .try_clone()
        .map_err(|e| format!("Failed to clone probe log: {}", e))?;
    let binary = core_process::find_singbox_binary()?;
    let mut command = core_process::hidden_command(&binary);
    let child = core_process::apply_deprecated_envs(&mut command)
        .args(["run", "-c", &config_path.to_string_lossy()])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn()
        .map_err(|e| format!("Failed to start latency probe core: {}", e))?;
    *probe_slot
        .lock()
        .map_err(|_| "Probe state is unavailable")? = Some(ProbeResources { child, dir });

    let endpoint = ApiEndpoint {
        base_url: format!("http://127.0.0.1:{}", port),
        secret,
        source: "probe".to_string(),
    };
    if api_ready(&endpoint, Duration::from_secs(6)).await {
        Ok(endpoint)
    } else {
        let details = fs::read_to_string(&log_path).unwrap_or_default();
        cleanup_probe(probe_slot);
        Err(if details.trim().is_empty() {
            "Latency probe core did not become ready".to_string()
        } else {
            format!("Latency probe core failed: {}", details.trim())
        })
    }
}

fn build_probe_config(
    source: &serde_json::Value,
    port: u16,
    secret: &str,
) -> Result<serde_json::Value, String> {
    let mut config = source.clone();
    if !config.is_object() {
        return Err("Profile config must be a JSON object".to_string());
    }
    config["inbounds"] = serde_json::json!([]);
    config["log"] = serde_json::json!({ "level": "error", "timestamp": true });
    config["experimental"] = serde_json::json!({});
    if let Some(route) = config
        .get_mut("route")
        .and_then(|value| value.as_object_mut())
    {
        route.insert("rules".to_string(), serde_json::json!([]));
        route.insert("rule_set".to_string(), serde_json::json!([]));
    }
    // DNS rules can reference route rule-sets. The probe deliberately removes
    // those remote rule-sets, so their dependent DNS rules must be removed too.
    if let Some(dns) = config
        .get_mut("dns")
        .and_then(|value| value.as_object_mut())
    {
        dns.insert("rules".to_string(), serde_json::json!([]));
    }
    inject_clash_api(&mut config, port, secret)?;
    Ok(config)
}

async fn api_ready(endpoint: &ApiEndpoint, timeout: Duration) -> bool {
    let client = reqwest::Client::new();
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        let mut request = client.get(format!("{}/version", endpoint.base_url));
        if !endpoint.secret.is_empty() {
            request = request.bearer_auth(&endpoint.secret);
        }
        if matches!(
            tokio::time::timeout(Duration::from_millis(500), request.send()).await,
            Ok(Ok(response)) if response.status().is_success()
        ) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    false
}

async fn proxy_delay_request(
    client: &reqwest::Client,
    endpoint: &ApiEndpoint,
    node_id: &str,
    options: &TestOptions,
) -> Result<u64, String> {
    let encoded = utf8_percent_encode(node_id, NON_ALPHANUMERIC).to_string();
    let timeout = options.timeout_ms.to_string();
    let mut request = client
        .get(format!("{}/proxies/{}/delay", endpoint.base_url, encoded))
        .query(&[("url", options.url.as_str()), ("timeout", timeout.as_str())])
        .timeout(Duration::from_millis(options.timeout_ms + 1_000));
    if !endpoint.secret.is_empty() {
        request = request.bearer_auth(&endpoint.secret);
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "timeout".to_string()
        } else {
            "network".to_string()
        }
    })?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let lower = body.to_ascii_lowercase();
        return Err(if lower.contains("timeout") || status.as_u16() == 504 {
            "timeout"
        } else if lower.contains("dns") {
            "dns"
        } else if lower.contains("tls") || lower.contains("certificate") {
            "tls"
        } else if status.as_u16() == 401 || status.as_u16() == 403 {
            "auth"
        } else {
            "api"
        }
        .to_string());
    }
    let value: serde_json::Value = serde_json::from_str(&body).map_err(|_| "api".to_string())?;
    value
        .get("delay")
        .and_then(|item| item.as_u64())
        .filter(|delay| *delay > 0)
        .ok_or_else(|| "network".to_string())
}

fn inject_clash_api(config: &mut serde_json::Value, port: u16, secret: &str) -> Result<(), String> {
    let root = config
        .as_object_mut()
        .ok_or("Config root must be a JSON object")?;
    let experimental = root
        .entry("experimental")
        .or_insert_with(|| serde_json::json!({}));
    if !experimental.is_object() {
        *experimental = serde_json::json!({});
    }
    let clash_api = experimental
        .as_object_mut()
        .expect("experimental was normalized to an object")
        .entry("clash_api")
        .or_insert_with(|| serde_json::json!({}));
    if !clash_api.is_object() {
        *clash_api = serde_json::json!({});
    }
    let clash_api = clash_api
        .as_object_mut()
        .expect("clash_api was normalized to an object");
    clash_api.insert(
        "external_controller".to_string(),
        serde_json::Value::String(format!("127.0.0.1:{}", port)),
    );
    clash_api.insert(
        "secret".to_string(),
        serde_json::Value::String(secret.to_string()),
    );
    Ok(())
}

fn inject_rule_set_cache(
    config: &mut serde_json::Value,
    profile_id: &str,
) -> Result<(), String> {
    let has_remote_rule_sets = config
        .get("route")
        .and_then(|route| route.get("rule_set"))
        .and_then(|rule_sets| rule_sets.as_array())
        .map(|rule_sets| {
            rule_sets.iter().any(|rule_set| {
                rule_set.get("type").and_then(|value| value.as_str()) == Some("remote")
            })
        })
        .unwrap_or(false);
    if !has_remote_rule_sets {
        return Ok(());
    }

    let root = config
        .as_object_mut()
        .ok_or("Config root must be a JSON object")?;
    let experimental = root
        .entry("experimental")
        .or_insert_with(|| serde_json::json!({}));
    if !experimental.is_object() {
        *experimental = serde_json::json!({});
    }
    let cache_file = experimental
        .as_object_mut()
        .expect("experimental was normalized to an object")
        .entry("cache_file")
        .or_insert_with(|| serde_json::json!({}));
    if !cache_file.is_object() {
        *cache_file = serde_json::json!({});
    }
    let cache_file = cache_file
        .as_object_mut()
        .expect("cache_file was normalized to an object");
    cache_file.insert("enabled".to_string(), serde_json::Value::Bool(true));
    cache_file.insert(
        "path".to_string(),
        serde_json::Value::String(
            app_paths::runtime_cache_path()
                .to_string_lossy()
                .to_string(),
        ),
    );
    cache_file.insert(
        "cache_id".to_string(),
        serde_json::Value::String(profile_id.to_string()),
    );
    Ok(())
}

fn reserve_local_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|e| format!("Failed to reserve Clash API port: {}", e))
}

pub(crate) fn config_fingerprint(content: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in content.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: &tauri::AppHandle,
    run_id: &str,
    profile_id: &str,
    state: &str,
    completed: usize,
    total: usize,
    succeeded: usize,
    failed: usize,
    result: Option<LatencyResult>,
    stage: &str,
) {
    let _ = app.emit(
        "latency-test-progress",
        LatencyTestProgress {
            run_id: run_id.to_string(),
            profile_id: profile_id.to_string(),
            state: state.to_string(),
            completed,
            total,
            succeeded,
            failed,
            result,
            stage: stage.to_string(),
        },
    );
}

fn kill_probe(probe: &Arc<Mutex<Option<ProbeResources>>>) {
    if let Ok(mut guard) = probe.lock() {
        if let Some(resources) = guard.as_mut() {
            let _ = resources.child.kill();
        }
    }
}

fn cleanup_probe(probe: &Arc<Mutex<Option<ProbeResources>>>) {
    if let Ok(mut guard) = probe.lock() {
        if let Some(mut resources) = guard.take() {
            let _ = resources.child.kill();
            let _ = resources.child.wait();
            let _ = fs::remove_dir_all(resources.dir);
        }
    }
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_clash_api_without_replacing_other_experimental_fields() {
        let mut config = serde_json::json!({
            "experimental": {
                "cache_file": { "enabled": true },
                "clash_api": { "external_ui": "dashboard" }
            }
        });
        inject_clash_api(&mut config, 20123, "secret").unwrap();
        assert_eq!(config["experimental"]["cache_file"]["enabled"], true);
        assert_eq!(
            config["experimental"]["clash_api"]["external_controller"],
            "127.0.0.1:20123"
        );
        assert_eq!(
            config["experimental"]["clash_api"]["external_ui"],
            "dashboard"
        );
    }

    #[test]
    fn enables_persistent_cache_for_remote_rule_sets() {
        let mut config = serde_json::json!({
            "experimental": { "cache_file": { "store_fakeip": true } },
            "route": {
                "rule_set": [
                    { "type": "remote", "tag": "cn", "url": "https://example.com/cn.srs" }
                ]
            }
        });

        inject_rule_set_cache(&mut config, "profile-a").unwrap();

        assert_eq!(config["experimental"]["cache_file"]["enabled"], true);
        assert_eq!(
            config["experimental"]["cache_file"]["cache_id"],
            "profile-a"
        );
        assert_eq!(
            config["experimental"]["cache_file"]["store_fakeip"],
            true
        );
        assert!(config["experimental"]["cache_file"]["path"]
            .as_str()
            .is_some_and(|path| path.ends_with("cache.db")));
    }

    #[test]
    fn resolves_only_leaf_outbounds_and_deduplicates_requested_tags() {
        let config = serde_json::json!({
            "outbounds": [
                { "type": "selector", "tag": "proxy" },
                { "type": "vless", "tag": "a" },
                { "type": "direct", "tag": "direct" }
            ]
        });
        assert_eq!(
            resolve_node_ids(&config, &["a".into(), "a".into(), "proxy".into()]),
            vec!["a"]
        );
    }

    #[test]
    fn probe_config_removes_rules_depending_on_remote_rule_sets() {
        let source = serde_json::json!({
            "dns": {
                "rules": [{ "rule_set": ["geosite-cn"], "server": "local" }],
                "servers": [{ "tag": "local", "address": "local" }]
            },
            "route": {
                "rules": [{ "rule_set": ["geosite-cn"], "outbound": "direct" }],
                "rule_set": [{ "tag": "geosite-cn", "type": "remote", "url": "https://example.com/cn.srs" }]
            },
            "outbounds": [{ "type": "direct", "tag": "direct" }]
        });

        let config = build_probe_config(&source, 20124, "secret").unwrap();

        assert_eq!(config["dns"]["rules"], serde_json::json!([]));
        assert_eq!(config["route"]["rules"], serde_json::json!([]));
        assert_eq!(config["route"]["rule_set"], serde_json::json!([]));
        assert_eq!(config["outbounds"], source["outbounds"]);
    }

    fn quick_result(node_id: &str, delay_ms: i64) -> LatencyResult {
        LatencyResult {
            profile_id: "profile".to_string(),
            node_id: node_id.to_string(),
            delay_ms,
            samples_ms: vec![delay_ms as u64],
            jitter_ms: Some(0),
            status: "ok".to_string(),
            error_kind: None,
            tested_at: 0,
            endpoint: DEFAULT_TEST_URL.to_string(),
            source: "runtime".to_string(),
            config_fingerprint: "fingerprint".to_string(),
            stage: "quick".to_string(),
            sample_count: 1,
            sample_target: 1,
            is_final: true,
        }
    }

    #[test]
    fn confirmation_candidates_include_top_five_and_nearby_nodes() {
        let order: Vec<String> = (0..7).map(|index| format!("node-{}", index)).collect();
        let delays = [100, 110, 120, 130, 140, 200, 260];
        let results = order
            .iter()
            .zip(delays)
            .map(|(node_id, delay)| (node_id.clone(), quick_result(node_id, delay)))
            .collect();

        assert_eq!(
            select_confirmation_candidates(&results, &order),
            order[..6].to_vec()
        );
    }

    #[test]
    fn accurate_result_uses_median_and_range_jitter() {
        let endpoint = ApiEndpoint {
            base_url: "http://127.0.0.1".to_string(),
            secret: String::new(),
            source: "runtime".to_string(),
        };
        let options = TestOptions {
            url: DEFAULT_TEST_URL.to_string(),
            timeout_ms: 5_000,
            concurrency: 16,
        };
        let state = NodeSampleState {
            node_id: "node".to_string(),
            samples: vec![800, 100, 120],
            last_error: None,
        };

        let result = build_latency_result(
            &state,
            "profile",
            &endpoint,
            &options,
            "fingerprint",
            2,
            3,
            "confirmed",
            true,
        );

        assert_eq!(result.delay_ms, 120);
        assert_eq!(result.jitter_ms, Some(700));
        assert_eq!(result.samples_ms, vec![100, 120, 800]);
    }

    #[test]
    fn accurate_test_stops_when_two_successes_are_impossible() {
        assert!(!cannot_reach_required_successes(0, 2, 2));
        assert!(cannot_reach_required_successes(0, 1, 2));
        assert!(!cannot_reach_required_successes(1, 1, 2));
    }

    #[tokio::test]
    async fn bundled_core_starts_isolated_probe_api() {
        if core_process::find_singbox_binary().is_err() {
            return;
        }
        let config = serde_json::json!({
            "outbounds": [{ "type": "direct", "tag": "direct" }],
            "route": { "final": "direct" }
        });
        let probe = Arc::new(Mutex::new(None));
        let endpoint = start_probe_core(&config, "test", "test", &probe)
            .await
            .expect("probe core should start");
        assert!(api_ready(&endpoint, Duration::from_secs(1)).await);
        cleanup_probe(&probe);
    }
}
