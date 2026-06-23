import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConfigProfile, ProxyNode } from "../types";

export interface Profile {
  tag: string;
  profile_type: string;
  outbounds: string[];
  default_outbound: string;
  interval: string;
  tolerance: number;
}

export function useSingbox() {
  const [nodes, setNodes] = useState<ProxyNode[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [configProfiles, setConfigProfiles] = useState<ConfigProfile[]>([]);
  const [activeConfigProfileId, setActiveConfigProfileId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [selectedOutboundTag, setSelectedOutboundTag] = useState<string | null>(null);
  const [hasConfig, setHasConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load nodes and check status on mount
  useEffect(() => {
    loadNodes();
    loadProfiles();
    loadConfigProfiles();
    checkStatus();
    checkConfig();
    loadActiveOutbound();
    loadActiveConfigProfile();
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
    } catch (err) {
      console.error("Status check failed:", err);
    }
  }, []);

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

  const loadActiveConfigProfile = useCallback(async () => {
    try {
      const id = await invoke<string>("get_active_config_profile");
      setActiveConfigProfileId(id || null);
    } catch (err) {
      console.error("Failed to load active config profile:", err);
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
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadNodes, loadProfiles]);

  const switchConfigProfile = useCallback(async (profileId: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<{ active_outbound: string }>("switch_config_profile", { profileId });
      await loadNodes();
      await loadProfiles();
      await loadConfigProfiles();
      await loadActiveConfigProfile();
      setHasConfig(true);
      setSelectedOutboundTag(result.active_outbound || null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadActiveConfigProfile, loadConfigProfiles, loadNodes, loadProfiles]);

  const deleteConfigProfile = useCallback(async (profileId: string) => {
    try {
      setLoading(true);
      setError(null);
      await invoke<string>("delete_config_profile", { profileId });
      await loadConfigProfiles();
      await checkConfig();
      await loadNodes();
      await loadProfiles();
      await loadActiveConfigProfile();
      await loadActiveOutbound();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [checkConfig, loadActiveConfigProfile, loadActiveOutbound, loadConfigProfiles, loadNodes, loadProfiles]);

  const selectOutboundTag = useCallback(async (tag: string) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedOutboundTag(tag);
      if (hasConfig) {
        await invoke<string>("set_active_outbound", { targetTag: tag });
        await loadProfiles();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [hasConfig, loadProfiles]);

  const startProxy = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (hasConfig) {
        if (selectedOutboundTag) {
          await invoke<string>("set_active_outbound", { targetTag: selectedOutboundTag });
        }
        // Use imported config (includes TUN + mixed inbound)
        // sing-box will be started with admin elevation for TUN
        // System proxy is set automatically by the backend
        await invoke<string>("start_singbox");
        setIsRunning(true);
        setProxyEnabled(true);
      } else {
        if (!selectedOutboundTag) {
          setError("Please select a node or import a config first");
          setLoading(false);
          return;
        }
        await invoke("generate_config", { selectedNodeId: selectedOutboundTag });
        await invoke<string>("start_singbox");
        setIsRunning(true);
        setProxyEnabled(true);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedOutboundTag, hasConfig]);

  const stopProxy = useCallback(async () => {
    try {
      setLoading(true);
      await invoke("stop_singbox");
      setIsRunning(false);
      await invoke("clear_system_proxy");
      setProxyEnabled(false);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

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
    await loadActiveConfigProfile();
    if (activeOutbound) {
      setSelectedOutboundTag(activeOutbound);
    }
  }, [checkConfig, loadActiveConfigProfile, loadActiveOutbound, loadConfigProfiles, loadNodes, loadProfiles]);

  return {
    nodes,
    profiles,
    configProfiles,
    activeConfigProfileId,
    isRunning,
    proxyEnabled,
    selectedOutboundTag,
    hasConfig,
    loading,
    error,
    setSelectedOutboundTag: selectOutboundTag,
    addNode,
    removeNode,
    removeGroup,
    switchConfigProfile,
    deleteConfigProfile,
    startProxy,
    stopProxy,
    toggleProxy,
    loadNodes,
    loadConfigProfiles,
    checkStatus,
    setError,
    onConfigImported,
  };
}
