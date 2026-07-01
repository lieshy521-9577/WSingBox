import { useState, useCallback, useEffect } from "react";
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

export function useSingbox() {
  const [nodes, setNodes] = useState<ProxyNode[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [configProfiles, setConfigProfiles] = useState<ConfigProfile[]>([]);
  const [activeConfigProfileId, setActiveConfigProfileId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [runtimePhase, setRuntimePhase] = useState<RuntimePhase>("stopped");
  const [selectedOutboundTag, setSelectedOutboundTag] = useState<string | null>(null);
  const [hasConfig, setHasConfig] = useState(false);
  const [runtimeDebug, setRuntimeDebug] = useState<RuntimeDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [switchStatus, setSwitchStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startupHealth, setStartupHealth] = useState<StartupHealthReport | null>(null);

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

  // Load nodes and check status on mount
  useEffect(() => {
    loadNodes();
    loadProfiles();
    loadConfigProfiles();
    checkStatus();
    checkConfig();
    loadActiveOutbound();
    loadRuntimeDebug();
    loadActiveConfigProfile();
    loadStartupHealth();
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
          return "running";
        }

        if (current === "starting" || current === "switching" || current === "stopping") {
          return current;
        }

        return "stopped";
      });
      await syncTrayConnectionState(running);
    } catch (err) {
      console.error("Status check failed:", err);
    }
  }, [syncTrayConnectionState]);

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
    let awaitingRuntimeReady = false;
    try {
      setLoading(true);
      setError(null);
      if (hasConfig) {
        setRuntimePhase(isRunning ? "switching" : "stopped");
        setSwitchStatus(`Applying ${tag}...`);
        await invoke("sync_active_profile_to_runtime");
        const actual = await invoke<string>("set_active_outbound", { targetTag: tag });
        if (isRunning) {
          setSwitchStatus("Stopping previous node...");
          await invoke("stop_singbox");
          setSwitchStatus("Starting selected node...");
          await invoke<string>("start_singbox");
          awaitingRuntimeReady = true;
        }
        await loadProfiles();
        await loadRuntimeDebug();
        await loadActiveOutbound();
        await checkStatus();
        setSelectedOutboundTag(actual || null);
        showTransientSwitchStatus(`Switched to ${actual || tag}`);
      } else {
        setSelectedOutboundTag(tag);
        showTransientSwitchStatus(`Selected ${tag}`);
      }
    } catch (err) {
      setSwitchStatus(null);
      setError(String(err));
    } finally {
      if (!awaitingRuntimeReady) {
        setLoading(false);
      }
    }
  }, [checkStatus, hasConfig, isRunning, loadActiveOutbound, loadProfiles, loadRuntimeDebug, showTransientSwitchStatus, syncTrayConnectionState]);

  const startProxy = useCallback(async () => {
    let awaitingRuntimeReady = false;
    try {
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
      if (!awaitingRuntimeReady) {
        setLoading(false);
      }
    }
  }, [selectedOutboundTag, hasConfig, loadProfiles, loadRuntimeDebug, loadStartupHealth, showTransientSwitchStatus]);

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

  return {
    nodes,
    profiles,
    configProfiles,
    activeConfigProfileId,
    isRunning,
    proxyEnabled,
    runtimePhase,
    selectedOutboundTag,
    runtimeDebug,
    startupHealth,
    hasConfig,
    loading,
    switchStatus,
    error,
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
