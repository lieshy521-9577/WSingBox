import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConfigProfile, ProxyNode, StartupHealthReport } from "../types";

export interface Profile {
  tag: string;
  profile_type: string;
  outbounds: string[];
  default_outbound: string;
  interval: string;
  tolerance: number;
}

export interface RuntimeDebugSnapshot {
  route_final: string;
  top_selector_tag: string;
  top_selector_default: string;
  active_leaf_outbound: string;
}

export type RuntimePhase =
  | "stopped"
  | "starting"
  | "switching"
  | "running"
  | "stopping"
  | "error";

interface CoreEventPayload {
  status: string;
  message: string;
}

interface RuntimeReconcileSnapshot {
  running: boolean;
  proxy_enabled: boolean;
  adopted_existing_runtime: boolean;
  cleared_stale_state: boolean;
  message: string;
}

interface RuntimeOutboundSwitchResult {
  requestedTag: string;
  activeTag: string;
  switchedLive: boolean;
  closedConnections: number;
  warnings: string[];
}

export function useSingbox() {
  const [nodes, setNodes] = useState<ProxyNode[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [configProfiles, setConfigProfiles] = useState<ConfigProfile[]>([]);
  const [activeConfigProfileId, setActiveConfigProfileId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [runtimePhase, setRuntimePhase] = useState<RuntimePhase>("stopped");
  const [selectedOutboundTag, setSelectedOutboundTag] = useState<string | null>(null);
  const [pendingOutboundTag, setPendingOutboundTag] = useState<string | null>(null);
  const [hasConfig, setHasConfig] = useState(false);
  const [runtimeDebug, setRuntimeDebug] = useState<RuntimeDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [switchStatus, setSwitchStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startupHealth, setStartupHealth] = useState<StartupHealthReport | null>(null);
  const [isElevated, setIsElevated] = useState<boolean | null>(null);
  const queuedOutboundTagRef = useRef<string | null>(null);
  const outboundSwitchWorkerRef = useRef<Promise<void> | null>(null);
  const startProxyInFlightRef = useRef(false);
  const isRunningRef = useRef(isRunning);
  const hasConfigRef = useRef(hasConfig);
  isRunningRef.current = isRunning;
  hasConfigRef.current = hasConfig;
  const tunNeedsElevation = Boolean(
    startupHealth?.items.some((item) => item.key === "tun" && item.status === "warn") &&
      isElevated === false
  );

  const syncTrayConnectionState = useCallback(async (connected: boolean) => {
    try {
      await invoke("set_tray_connection_state", { connected });
    } catch (err) {
      console.error("Failed to sync tray connection state:", err);
    }
  }, []);

  const showTransientSwitchStatus = useCallback((message: string) => {
    setSwitchStatus(message);
    window.setTimeout(() => {
      setSwitchStatus((current) => (current === message ? null : current));
    }, 1800);
  }, []);

  const checkElevation = useCallback(async () => {
    try {
      const elevated = await invoke<boolean>("is_elevated");
      setIsElevated(elevated);
    } catch (err) {
      console.error("Failed to check elevation status:", err);
      setIsElevated(false);
    }
  }, []);

  const requestElevation = useCallback(async () => {
    try {
      await invoke("request_elevation");
      // The app will exit and restart as admin — this process ends here
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const reconcileRuntime = useCallback(async () => {
    try {
      const snapshot = await invoke<RuntimeReconcileSnapshot>("reconcile_runtime_state");
      setIsRunning(snapshot.running);
      setProxyEnabled(snapshot.proxy_enabled);
      setRuntimePhase(snapshot.running ? "running" : "stopped");
      if (snapshot.running) {
        setError(null);
        setSwitchStatus(snapshot.message || "Existing runtime detected");
      } else if (snapshot.cleared_stale_state) {
        setError(null);
        setSwitchStatus("Cleared stale runtime state");
      }
      await syncTrayConnectionState(snapshot.running);
      return snapshot;
    } catch (err) {
      console.error("Failed to reconcile runtime state:", err);
      return null;
    }
  }, [syncTrayConnectionState]);

  // Load nodes and check status on mount
  useEffect(() => {
    void (async () => {
      await reconcileRuntime();
      await Promise.all([
        loadNodes(),
        loadProfiles(),
        loadConfigProfiles(),
        checkStatus(),
        checkConfig(),
        loadActiveOutbound(),
        loadRuntimeDebug(),
        loadActiveConfigProfile(),
        loadStartupHealth(),
        checkElevation(),
      ]);
    })();
  }, []);

  const loadNodes = useCallback(async () => {
    try {
      const result = await invoke<ProxyNode[]>("get_nodes");
      setNodes(result);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const result = await invoke<Profile[]>("get_profiles");
      setProfiles(result);
    } catch (err) {
      console.error("Failed to load profiles:", err);
    }
  }, []);

  const checkConfig = useCallback(async () => {
    try {
      const has = await invoke<boolean>("has_imported_config");
      setHasConfig(has);
      if (!has) {
        setSelectedOutboundTag(null);
        setActiveConfigProfileId(null);
      }
    } catch (err) {
      console.error("Failed to check config:", err);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const running = await invoke<boolean>("get_singbox_status");
      setIsRunning(running);
      const proxy = await invoke<boolean>("get_proxy_status");
      setProxyEnabled(proxy);
      setRuntimePhase((current) => {
        if (running) {
          if (
            loading &&
            (current === "starting" || current === "switching" || current === "stopping")
          ) {
            return current;
          }
          return "running";
        }

        if (
          loading &&
          (current === "starting" || current === "switching" || current === "stopping")
        ) {
          return current;
        }

        return "stopped";
      });
      if (running) {
        setError(null);
      }
      await syncTrayConnectionState(running);
    } catch (err) {
      console.error("Status check failed:", err);
    }
  }, [loading, syncTrayConnectionState]);

  const loadActiveOutbound = useCallback(async () => {
    try {
      const outbound = await invoke<string>("get_active_outbound");
      setSelectedOutboundTag(outbound || null);
    } catch (err) {
      console.error("Failed to load active outbound:", err);
    }
  }, []);

  const loadConfigProfiles = useCallback(async () => {
    try {
      const result = await invoke<ConfigProfile[]>("get_config_profiles");
      setConfigProfiles(result);
    } catch (err) {
      console.error("Failed to load config profiles:", err);
    }
  }, []);

  const loadRuntimeDebug = useCallback(async () => {
    try {
      const result = await invoke<RuntimeDebugSnapshot>("get_runtime_debug_snapshot");
      setRuntimeDebug(result);
    } catch (err) {
      console.error("Failed to load runtime debug snapshot:", err);
    }
  }, []);

  const loadActiveConfigProfile = useCallback(async () => {
    try {
      const id = await invoke<string>("get_active_config_profile");
      setActiveConfigProfileId(id || null);
    } catch (err) {
      console.error("Failed to load active config profile:", err);
    }
  }, []);

  const loadStartupHealth = useCallback(async () => {
    try {
      const report = await invoke<StartupHealthReport>("get_startup_health_report");
      setStartupHealth(report);
      return report;
    } catch (err) {
      console.error("Failed to load startup health report:", err);
      return null;
    }
  }, []);

  const addNode = useCallback(
    async (
      name: string,
      nodeType: string,
      server: string,
      port: number,
      settings: Record<string, unknown>
    ) => {
      try {
        setLoading(true);
        const node = await invoke<ProxyNode>("add_node", {
          name,
          nodeType,
          server,
          port,
          settings,
        });
        setNodes((prev) => [...prev, node]);
        setError(null);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const updateNode = useCallback(
    async (
      id: string,
      name: string,
      nodeType: string,
      server: string,
      port: number,
      settings: Record<string, unknown>
    ) => {
      try {
        setLoading(true);
        const node = await invoke<ProxyNode>("update_node", {
          id,
          name,
          nodeType,
          server,
          port,
          settings,
        });
        setNodes((prev) => prev.map((item) => (item.id === id ? node : item)));
        setError(null);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const removeNode = useCallback(async (id: string) => {
    try {
      await invoke("remove_node", { id });
      setNodes((prev) => prev.filter((n) => n.id !== id));
      if (selectedOutboundTag === id) {
        setSelectedOutboundTag(null);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [selectedOutboundTag]);

  const removeGroup = useCallback(async (tag: string) => {
    try {
      setLoading(true);
      setError(null);
      await invoke<string>("remove_group", { groupTag: tag });
      await loadNodes();
      await loadProfiles();
      const active = await invoke<string>("get_active_outbound");
      setSelectedOutboundTag(active || null);
      await loadRuntimeDebug();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadNodes, loadProfiles, loadRuntimeDebug]);

  const switchConfigProfile = useCallback(async (profileId: string) => {
    try {
      setLoading(true);
      setError(null);
      setSwitchStatus("Loading selected profile...");
      const result = await invoke<{ active_outbound: string }>("switch_config_profile", { profileId });
      await loadNodes();
      await loadProfiles();
      await loadConfigProfiles();
      await loadRuntimeDebug();
      await loadActiveConfigProfile();
      await loadActiveOutbound();
      await loadStartupHealth();
      await checkStatus();
      setHasConfig(true);
      setSelectedOutboundTag(result.active_outbound || null);
      showTransientSwitchStatus(
        isRunning
          ? "Profile loaded. Click a node to reconnect."
          : `Switched to ${result.active_outbound || "selected profile"}`
      );
    } catch (err) {
      setSwitchStatus(null);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [checkStatus, isRunning, loadActiveConfigProfile, loadActiveOutbound, loadConfigProfiles, loadNodes, loadProfiles, loadRuntimeDebug, loadStartupHealth, showTransientSwitchStatus]);

  const deleteConfigProfile = useCallback(async (profileId: string) => {
    try {
      setLoading(true);
      setError(null);
      await invoke<string>("delete_config_profile", { profileId });
      await loadConfigProfiles();
      await checkConfig();
      await loadNodes();
      await loadProfiles();
      await loadRuntimeDebug();
      await loadActiveConfigProfile();
      await loadActiveOutbound();
      await loadStartupHealth();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [checkConfig, loadActiveConfigProfile, loadActiveOutbound, loadConfigProfiles, loadNodes, loadProfiles, loadRuntimeDebug, loadStartupHealth]);

  const renameConfigProfile = useCallback(async (profileId: string, newName: string) => {
    try {
      setLoading(true);
      setError(null);
      await invoke("rename_config_profile", { profileId, newName });
      await loadConfigProfiles();
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadConfigProfiles]);

  const refreshConfigProfile = useCallback(async (profileId: string) => {
    try {
      setLoading(true);
      setError(null);
      setSwitchStatus("Refreshing profile...");
      const result = await invoke<{ active_outbound: string }>("refresh_config_profile", { profileId });
      await loadNodes();
      await loadProfiles();
      await loadConfigProfiles();
      await loadRuntimeDebug();
      await loadActiveConfigProfile();
      await loadActiveOutbound();
      await loadStartupHealth();
      setSelectedOutboundTag(result.active_outbound || null);
      showTransientSwitchStatus("Profile refreshed");
    } catch (err) {
      setSwitchStatus(null);
      setError(String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadActiveConfigProfile, loadActiveOutbound, loadConfigProfiles, loadNodes, loadProfiles, loadRuntimeDebug, loadStartupHealth, showTransientSwitchStatus]);

  const selectOutboundTag = useCallback(async (tag: string) => {
    queuedOutboundTagRef.current = tag;
    setPendingOutboundTag(tag);
    setError(null);

    if (outboundSwitchWorkerRef.current) {
      await outboundSwitchWorkerRef.current;
      return;
    }

    const worker = (async () => {
      while (queuedOutboundTagRef.current) {
        const target = queuedOutboundTagRef.current;
        queuedOutboundTagRef.current = null;
        setPendingOutboundTag(target);

        if (!hasConfigRef.current) {
          setSelectedOutboundTag(target);
          setPendingOutboundTag(null);
          showTransientSwitchStatus(`Selected ${target}`);
          continue;
        }

        const wasRunning = isRunningRef.current;
        if (wasRunning) setRuntimePhase("switching");
        setSwitchStatus(`Switching to ${target}...`);

        try {
          const result = await invoke<RuntimeOutboundSwitchResult>("switch_runtime_outbound", {
            request: { targetTag: target, closeAffectedConnections: true },
          });
          if (queuedOutboundTagRef.current) continue;

          isRunningRef.current = result.switchedLive;
          if (!result.switchedLive && wasRunning) {
            setIsRunning(false);
            setProxyEnabled(false);
            await syncTrayConnectionState(false);
          }
          setSelectedOutboundTag(result.activeTag || target);
          await Promise.all([loadProfiles(), loadRuntimeDebug()]);
          setRuntimePhase(result.switchedLive ? "running" : "stopped");
          setPendingOutboundTag(null);
          const connectionNote = result.closedConnections > 0
            ? ` · closed ${result.closedConnections} affected connection${result.closedConnections === 1 ? "" : "s"}`
            : "";
          const warningNote = result.warnings.length > 0 ? ` · ${result.warnings.join("; ")}` : "";
          showTransientSwitchStatus(`Switched to ${result.activeTag || target}${connectionNote}${warningNote}`);
        } catch (err) {
          if (queuedOutboundTagRef.current) continue;
          await Promise.all([loadActiveOutbound(), loadRuntimeDebug()]);
          setRuntimePhase(isRunningRef.current ? "running" : "stopped");
          setPendingOutboundTag(null);
          setSwitchStatus(null);
          setError(String(err));
        }
      }
    })();

    outboundSwitchWorkerRef.current = worker;
    try {
      await worker;
    } finally {
      if (outboundSwitchWorkerRef.current === worker) {
        outboundSwitchWorkerRef.current = null;
      }
    }
  }, [loadActiveOutbound, loadProfiles, loadRuntimeDebug, showTransientSwitchStatus, syncTrayConnectionState]);

  const startProxy = useCallback(async () => {
    if (startProxyInFlightRef.current) return;
    startProxyInFlightRef.current = true;
    let awaitingRuntimeReady = false;
    try {
      if (tunNeedsElevation) {
        setLoading(false);
        setRuntimePhase("stopped");
        setSwitchStatus("Restarting as administrator for TUN mode...");
        await syncTrayConnectionState(false);
        await requestElevation();
        return;
      }

      setLoading(true);
      setError(null);
      setRuntimePhase("starting");
      setSwitchStatus("Starting sing-box...");

      if (hasConfig) {
        await invoke("sync_active_profile_to_runtime");
        const health = await loadStartupHealth();
        if (health && !health.ready) {
          const firstError = health.items.find((item) => item.status === "error");
          setError(firstError?.message || "Startup health check failed");
          setSwitchStatus(null);
          setLoading(false);
          return;
        }
        const tunRequiresElevation = Boolean(
          health?.items.some((item) => item.key === "tun" && item.status === "warn")
        );
        if (tunRequiresElevation && isElevated === false) {
          setRuntimePhase("stopped");
          setSwitchStatus("Restarting as administrator for TUN mode...");
          await syncTrayConnectionState(false);
          await requestElevation();
          return;
        }
        if (selectedOutboundTag) {
          const actual = await invoke<string>("set_active_outbound", { targetTag: selectedOutboundTag });
          setSelectedOutboundTag(actual || null);
          await loadProfiles();
          await loadRuntimeDebug();
        }
        // Use imported config (includes TUN + mixed inbound)
        // sing-box will be started with admin elevation for TUN
        // System proxy is set automatically by the backend
        await invoke<string>("start_singbox");
        awaitingRuntimeReady = true;
        showTransientSwitchStatus("Sing-box started");
      } else {
        if (!selectedOutboundTag) {
          setError("Please select a node or import a config first");
          setSwitchStatus(null);
          setLoading(false);
          return;
        }
        await invoke("generate_config", { selectedNodeId: selectedOutboundTag });
        const health = await loadStartupHealth();
        if (health && !health.ready) {
          const firstError = health.items.find((item) => item.status === "error");
          setError(firstError?.message || "Startup health check failed");
          setSwitchStatus(null);
          setLoading(false);
          return;
        }
        await invoke<string>("start_singbox");
        awaitingRuntimeReady = true;
        showTransientSwitchStatus(`Started with ${selectedOutboundTag}`);
      }
    } catch (err) {
      setRuntimePhase("error");
      setSwitchStatus(null);
      setError(String(err));
    } finally {
      startProxyInFlightRef.current = false;
      if (!awaitingRuntimeReady) {
        setLoading(false);
      }
    }
  }, [selectedOutboundTag, hasConfig, isElevated, loadProfiles, loadRuntimeDebug, loadStartupHealth, requestElevation, showTransientSwitchStatus, syncTrayConnectionState, tunNeedsElevation]);

  const stopProxy = useCallback(async () => {
    try {
      setLoading(true);
      setRuntimePhase("stopping");
      setSwitchStatus("Stopping sing-box...");
      await invoke("stop_singbox");
      await checkStatus();
      await syncTrayConnectionState(false);
      setError(null);
      showTransientSwitchStatus("Connection closed");
    } catch (err) {
      setRuntimePhase("error");
      setSwitchStatus(null);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [checkStatus, showTransientSwitchStatus, syncTrayConnectionState]);

  const toggleProxy = useCallback(async () => {
    if (isRunning) {
      await stopProxy();
    } else {
      await startProxy();
    }
  }, [isRunning, startProxy, stopProxy]);

  // Called after import to refresh state
  const onConfigImported = useCallback(async (activeOutbound: string) => {
    await loadNodes();
    await loadProfiles();
    await loadConfigProfiles();
    await checkConfig();
    await loadActiveOutbound();
    await loadRuntimeDebug();
    await loadActiveConfigProfile();
    await loadStartupHealth();
    if (activeOutbound) {
      setSelectedOutboundTag(activeOutbound);
    }
  }, [checkConfig, loadActiveConfigProfile, loadActiveOutbound, loadConfigProfiles, loadNodes, loadProfiles, loadRuntimeDebug, loadStartupHealth]);

  useEffect(() => {
    let unlistenStarting: (() => void) | undefined;
    let unlistenReady: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;
    let unlistenStopped: (() => void) | undefined;

    const setup = async () => {
      unlistenStarting = await listen<CoreEventPayload>("core-starting", (event) => {
        setLoading(true);
        setRuntimePhase((current) => (current === "switching" ? "switching" : "starting"));
        setSwitchStatus(event.payload.message || "Starting sing-box...");
      });

      unlistenReady = await listen<CoreEventPayload>("core-ready", async (event) => {
        setIsRunning(true);
        setRuntimePhase("running");
        setLoading(false);
        setError(null);
        setProxyEnabled(true);
        setSwitchStatus(event.payload.message || "Sing-box ready");
        await syncTrayConnectionState(true);
        await Promise.allSettled([checkStatus(), loadRuntimeDebug(), loadActiveOutbound()]);
      });

      unlistenFailed = await listen<CoreEventPayload>("core-failed", async (event) => {
        setIsRunning(false);
        setRuntimePhase("error");
        setLoading(false);
        setProxyEnabled(false);
        setSwitchStatus(null);
        setError(event.payload.message || "sing-box failed to start");
        await syncTrayConnectionState(false);
        await Promise.allSettled([checkStatus(), loadRuntimeDebug()]);
      });

      unlistenStopped = await listen<CoreEventPayload>("core-stopped", async (event) => {
        setIsRunning(false);
        setRuntimePhase("stopped");
        setLoading(false);
        setProxyEnabled(false);
        setSwitchStatus(event.payload.message || "sing-box stopped");
        await syncTrayConnectionState(false);
        await Promise.allSettled([checkStatus(), loadRuntimeDebug()]);
      });
    };

    void setup();

    return () => {
      unlistenStarting?.();
      unlistenReady?.();
      unlistenFailed?.();
      unlistenStopped?.();
    };
  }, [checkStatus, loadActiveOutbound, loadRuntimeDebug, syncTrayConnectionState]);

  // Handle elevation intent — auto-connect after admin restart
  useEffect(() => {
    if (isElevated !== true || !hasConfig) {
      return;
    }

    (async () => {
      try {
        const shouldAutoConnect = await invoke<boolean>("check_elevation_intent");
        if (shouldAutoConnect) {
          // App restarted as admin — auto-connect
          await startProxy();
        }
      } catch (err) {
        console.error("Failed to handle elevation intent:", err);
      }
    })();
  }, [hasConfig, isElevated, startProxy]);

  useEffect(() => {
    if (!tunNeedsElevation) {
      return;
    }

    setLoading(false);
    setIsRunning(false);
    setProxyEnabled(false);
    setError(null);
    setRuntimePhase((current) =>
      current === "starting" || current === "error" ? "stopped" : current
    );
    setSwitchStatus((current) =>
      current?.includes("administrator") ? current : "Administrator restart required for TUN mode"
    );
  }, [tunNeedsElevation]);

  return {
    nodes,
    profiles,
    configProfiles,
    activeConfigProfileId,
    isRunning,
    proxyEnabled,
    runtimePhase,
    selectedOutboundTag,
    pendingOutboundTag,
    runtimeDebug,
    startupHealth,
    tunNeedsElevation,
    hasConfig,
    loading,
    switchStatus,
    error,
    isElevated,
    requestElevation,
    setSelectedOutboundTag: selectOutboundTag,
    addNode,
    updateNode,
    removeNode,
    removeGroup,
    switchConfigProfile,
    deleteConfigProfile,
    renameConfigProfile,
    refreshConfigProfile,
    startProxy,
    stopProxy,
    toggleProxy,
    loadNodes,
    loadConfigProfiles,
    loadStartupHealth,
    checkStatus,
    setError,
    onConfigImported,
  };
}
