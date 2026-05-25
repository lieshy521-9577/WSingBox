import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProxyNode } from "../types";

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
  const [isRunning, setIsRunning] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hasConfig, setHasConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load nodes and check status on mount
  useEffect(() => {
    loadNodes();
    loadProfiles();
    checkStatus();
    checkConfig();
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
      if (selectedNodeId === id) {
        setSelectedNodeId(null);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [selectedNodeId]);

  const startProxy = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (hasConfig) {
        // Use imported config (includes TUN + mixed inbound)
        // sing-box will be started with admin elevation for TUN
        // System proxy is set automatically by the backend
        await invoke<string>("start_singbox");
        setIsRunning(true);
        setProxyEnabled(true);
      } else {
        if (!selectedNodeId) {
          setError("Please select a node or import a config first");
          setLoading(false);
          return;
        }
        await invoke("generate_config", { selectedNodeId });
        await invoke<string>("start_singbox");
        setIsRunning(true);
        setProxyEnabled(true);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedNodeId, hasConfig]);

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
  const onConfigImported = useCallback(async (activeNode: string) => {
    await loadNodes();
    await loadProfiles();
    setHasConfig(true);
    if (activeNode) {
      setSelectedNodeId(activeNode);
    }
  }, [loadNodes, loadProfiles]);

  return {
    nodes,
    profiles,
    isRunning,
    proxyEnabled,
    selectedNodeId,
    hasConfig,
    loading,
    error,
    setSelectedNodeId,
    addNode,
    removeNode,
    startProxy,
    stopProxy,
    toggleProxy,
    loadNodes,
    checkStatus,
    setError,
    onConfigImported,
  };
}
