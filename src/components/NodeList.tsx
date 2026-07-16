import { startTransition, useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Plus,
  Trash2,
  Server,
  CheckCircle2,
  Activity,
  Layers3,
  ChevronDown,
  ChevronRight,
  Pencil,
  X,
  Loader2,
} from "lucide-react";
import { AppSettings, ProxyNode, PROTOCOL_LABELS, ProtocolType } from "../types";
import { Profile, RuntimeDebugSnapshot, RuntimePhase } from "../hooks/useSingbox";

interface LatencyResult {
  profileId: string;
  nodeId: string;
  delayMs: number;
  samplesMs: number[];
  jitterMs: number | null;
  status: string;
  errorKind: string | null;
  testedAt: number;
  endpoint: string;
  source: "runtime" | "probe";
  configFingerprint: string;
  stage: "quick" | "confirmed";
  sampleCount: number;
  sampleTarget: number;
  final: boolean;
}

type LatencyTestMode = "quick_auto" | "accurate";

interface LatencyBatchSnapshot {
  runId: string;
  profileId: string;
  state: "idle" | "running" | "completed" | "cancelled";
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  results: LatencyResult[];
  stage: "quick" | "confirmed" | "completed";
}

interface LatencyTestProgress extends Omit<LatencyBatchSnapshot, "results"> {
  result: LatencyResult | null;
}

interface ConnectivityResult {
  nodeId: string;
  connectMs: number;
  status: string;
  errorKind: string | null;
}

interface NodeListProps {
  nodes: ProxyNode[];
  profiles: Profile[];
  selectedOutboundTag: string | null;
  pendingOutboundTag: string | null;
  runtimeDebug: RuntimeDebugSnapshot | null;
  runtimePhase: RuntimePhase;
  isRunning: boolean;
  hasConfig: boolean;
  activeConfigProfileId: string | null;
  onSelect: (tag: string) => void;
  onRemove: (id: string) => void;
  onRemoveGroup: (tag: string) => void;
  onAdd: () => void;
  onEdit: (node: ProxyNode) => void;
}

/* ── Flag emoji mapping ── */
const FLAG_MAP: Record<string, string> = {
  US: "\u{1F1FA}\u{1F1F8}", HK: "\u{1F1ED}\u{1F1F0}", JP: "\u{1F1EF}\u{1F1F5}",
  SG: "\u{1F1F8}\u{1F1EC}", KR: "\u{1F1F0}\u{1F1F7}", TW: "\u{1F1F9}\u{1F1FC}",
  DE: "\u{1F1E9}\u{1F1EA}", NL: "\u{1F1F3}\u{1F1F1}", GB: "\u{1F1EC}\u{1F1E7}",
  FR: "\u{1F1EB}\u{1F1F7}", CA: "\u{1F1E8}\u{1F1E6}", AU: "\u{1F1E6}\u{1F1FA}",
  RU: "\u{1F1F7}\u{1F1FA}", IN: "\u{1F1EE}\u{1F1F3}", BR: "\u{1F1E7}\u{1F1F7}",
  UA: "\u{1F1FA}\u{1F1E6}", SE: "\u{1F1F8}\u{1F1EA}", CH: "\u{1F1E8}\u{1F1ED}",
};

function guessFlag(tag: string): string {
  const upper = tag.toUpperCase();
  for (const [code, flag] of Object.entries(FLAG_MAP)) {
    if (upper.includes(code)) return flag;
  }
  return "\u{1F310}"; // globe
}

function sortNodeIds(
  currentOrder: string[],
  nodes: ProxyNode[],
  latencies: Record<string, LatencyResult>
): string[] {
  const validIds = new Set(nodes.map((node) => node.id));
  const order = currentOrder.filter((nodeId) => validIds.has(nodeId));
  const seen = new Set(order);
  for (const node of nodes) {
    if (!seen.has(node.id)) order.push(node.id);
  }
  const stableIndex = new Map(order.map((nodeId, index) => [nodeId, index]));
  const rank = (result: LatencyResult | undefined) => {
    if (result?.status === "ok") return 0;
    if (!result) return 1;
    return 2;
  };
  return [...order].sort((leftId, rightId) => {
    const left = latencies[leftId];
    const right = latencies[rightId];
    const rankDifference = rank(left) - rank(right);
    if (rankDifference !== 0) return rankDifference;
    if (left?.status === "ok" && right?.status === "ok") {
      const difference = left.delayMs - right.delayMs;
      if (Math.abs(difference) >= 30) return difference;
    }
    return (stableIndex.get(leftId) ?? 0) - (stableIndex.get(rightId) ?? 0);
  });
}

function NodeList({
  nodes,
  profiles,
  selectedOutboundTag,
  pendingOutboundTag,
  runtimeDebug,
  runtimePhase,
  isRunning,
  hasConfig,
  activeConfigProfileId,
  onSelect,
  onRemove,
  onRemoveGroup,
  onAdd,
  onEdit,
}: NodeListProps) {
  const [latencies, setLatencies] = useState<Record<string, LatencyResult>>({});
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState<LatencyBatchSnapshot | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [latencySettings, setLatencySettings] = useState<AppSettings | null>(null);
  const [selectedDetailNode, setSelectedDetailNode] = useState<ProxyNode | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [testingNodeIds, setTestingNodeIds] = useState<Set<string>>(() => new Set());
  const [displayNodeIds, setDisplayNodeIds] = useState<string[]>(() => nodes.map((node) => node.id));

  const activeRunIdRef = useRef("");
  const autoTestedKeyRef = useRef("");
  const latenciesRef = useRef<Record<string, LatencyResult>>({});
  const progressStageRef = useRef<LatencyBatchSnapshot["stage"] | null>(null);
  const displayNodeIdsRef = useRef(displayNodeIds);
  const nodeGridRef = useRef<HTMLDivElement | null>(null);
  const flipRectsRef = useRef<Map<string, DOMRect> | null>(null);

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node])),
    [nodes]
  );
  const latencyProfileId = activeConfigProfileId ?? (nodes.length > 0 ? "__manual__" : null);

  const topSelectorTag = profiles.find((p) => p.profile_type === "selector")?.tag ?? profiles[0]?.tag ?? null;
  const recommendedNodeId = useMemo(() => {
    const healthy = Object.values(latencies).filter((item) => item.status === "ok");
    return healthy.reduce<LatencyResult | null>(
      (best, item) => !best || item.delayMs < best.delayMs ? item : best,
      null
    )?.nodeId ?? null;
  }, [latencies]);
  const hasLatencyResults = Object.keys(latencies).length > 0;
  const compareNodeLatency = useCallback((leftId: string, rightId: string) => {
    const left = latencies[leftId];
    const right = latencies[rightId];
    const rank = (result: LatencyResult | undefined) => {
      if (result?.status === "ok") return 0;
      if (!result) return 1;
      return 2;
    };
    const rankDifference = rank(left) - rank(right);
    if (rankDifference !== 0) return rankDifference;
    if (left?.status === "ok" && right?.status === "ok" && Math.abs(left.delayMs - right.delayMs) >= 30) {
      return left.delayMs - right.delayMs;
    }
    return 0;
  }, [latencies]);
  const displayedNodes = useMemo(
    () => displayNodeIds.map((nodeId) => nodeMap[nodeId]).filter((node): node is ProxyNode => Boolean(node)),
    [displayNodeIds, nodeMap]
  );
  const sortGroupMembers = useCallback(
    (memberTags: string[]) => testing ? memberTags : [...memberTags].sort(compareNodeLatency),
    [compareNodeLatency, testing]
  );
  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => !(profile.tag === "proxy" && profile.profile_type === "selector")),
    [profiles]
  );

  const applyLatencySort = useCallback((snapshot: Record<string, LatencyResult>) => {
    const nextOrder = sortNodeIds(displayNodeIdsRef.current, nodes, snapshot);
    if (nextOrder.length === displayNodeIdsRef.current.length
      && nextOrder.every((nodeId, index) => displayNodeIdsRef.current[index] === nodeId)) return;
    const firstRects = new Map<string, DOMRect>();
    nodeGridRef.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
      if (element.dataset.nodeId) firstRects.set(element.dataset.nodeId, element.getBoundingClientRect());
    });
    flipRectsRef.current = firstRects;
    displayNodeIdsRef.current = nextOrder;
    setDisplayNodeIds(nextOrder);
  }, [nodes]);

  useEffect(() => {
    const nextOrder = sortNodeIds(displayNodeIdsRef.current, nodes, latenciesRef.current);
    displayNodeIdsRef.current = nextOrder;
    setDisplayNodeIds(nextOrder);
  }, [nodes]);

  useLayoutEffect(() => {
    const firstRects = flipRectsRef.current;
    flipRectsRef.current = null;
    if (!firstRects || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    nodeGridRef.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
      const nodeId = element.dataset.nodeId;
      const first = nodeId ? firstRects.get(nodeId) : undefined;
      if (!first) return;
      const last = element.getBoundingClientRect();
      const deltaX = first.left - last.left;
      const deltaY = first.top - last.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      element.getAnimations().forEach((animation) => animation.cancel());
      element.animate(
        [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }],
        { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    });
  }, [displayNodeIds]);

  const startLatencyTest = useCallback(async (nodeIds: string[], mode: LatencyTestMode = "accurate") => {
    if (!latencyProfileId || nodeIds.length === 0) return;
    setTesting(true);
    setTestingNodeIds(new Set(nodeIds));
    setTestError(null);
    progressStageRef.current = mode === "quick_auto" ? "quick" : "confirmed";
    setTestProgress({
      runId: "", profileId: latencyProfileId, state: "running",
      completed: 0, total: nodeIds.length, succeeded: 0, failed: 0, results: [],
      stage: mode === "quick_auto" ? "quick" : "confirmed",
    });
    try {
      const snapshot = await invoke<LatencyBatchSnapshot>("start_latency_test", {
        request: { profileId: latencyProfileId, nodeIds, mode },
      });
      activeRunIdRef.current = snapshot.runId;
      const merged = {
        ...latenciesRef.current,
        ...Object.fromEntries(snapshot.results.map((item) => [item.nodeId, item])),
      };
      latenciesRef.current = merged;
      setLatencies(merged);
      applyLatencySort(merged);
      setTestProgress(snapshot);
    } catch (error) {
      console.error("Latency test failed:", error);
      setTestError(String(error));
      setTestProgress((prev) => prev ? { ...prev, state: "cancelled" } : null);
    } finally {
      setTesting(false);
      setTestingNodeIds(new Set());
    }
  }, [applyLatencySort, latencyProfileId]);

  const testAllLatency = useCallback((mode: LatencyTestMode = "accurate") => {
    const nodeIds = nodes.filter((node) => node.server && node.port !== 0).map((node) => node.id);
    return startLatencyTest(nodeIds, mode);
  }, [nodes, startLatencyTest]);

  const cancelLatencyTest = useCallback(async () => {
    await invoke("cancel_latency_test", { runId: activeRunIdRef.current });
  }, []);

  const renderLatency = (nodeId: string) => {
    const result = latencies[nodeId];
    if (testingNodeIds.has(nodeId) && !result) {
      return (
        <span className="inline-flex min-w-[4.8rem] items-center justify-end gap-1 text-xs text-content-muted">
          <Loader2 size={11} className="animate-spin" /> Testing
        </span>
      );
    }
    if (!result) return null;
    if (result.status === "ok") {
      const ms = result.delayMs;
      let color = "text-green-500";
      if (ms > 300) color = "text-yellow-500";
      if (ms > 800) color = "text-red-500";
      return (
        <button type="button" onClick={(event) => { event.stopPropagation(); void startLatencyTest([nodeId]); }}
          className={`inline-flex min-w-[4.8rem] justify-end text-xs font-mono tabular-nums ${color}`}
          title={`${result.stage === "quick" ? "Quick estimate" : "Confirmed median"} · jitter ${result.jitterMs ?? 0}ms · ${result.source}`}>
          {result.stage === "quick" ? "~" : ""}{ms}ms
        </button>
      );
    }
    if (result.status === "timeout") return <span className="inline-flex min-w-[4.8rem] justify-end text-xs text-red-500" title="URL test timed out">Timeout</span>;
    return <span className="inline-flex min-w-[4.8rem] justify-end text-xs text-red-500" title={result.errorKind ?? "URL test failed"}>Failed</span>;
  };

  const toggleGroup = (tag: string) => setExpandedGroups((prev) => ({ ...prev, [tag]: !prev[tag] }));

  const resolveMemberNodeTags = useCallback((memberTags: string[], visited = new Set<string>()) => {
    const resolved: string[] = [];
    for (const tag of memberTags) {
      if (nodeMap[tag]) { resolved.push(tag); continue; }
      if (visited.has(tag)) continue;
      const memberProfile = profiles.find((p) => p.tag === tag);
      if (memberProfile) { visited.add(tag); resolved.push(...resolveMemberNodeTags(memberProfile.outbounds, visited)); }
    }
    return resolved;
  }, [nodeMap, profiles]);

  const renderGroupLatency = (memberTags: string[]) => {
    const candidates = resolveMemberNodeTags(memberTags)
      .map((tag) => latencies[tag])
      .filter((result): result is LatencyResult => !!result && result.status === "ok");
    if (candidates.length === 0) return null;
    const fastest = candidates.reduce((best, c) => c.delayMs < best.delayMs ? c : best);
    let color = "text-green-500";
    if (fastest.delayMs > 300) color = "text-yellow-500";
    if (fastest.delayMs > 800) color = "text-red-500";
    return (
      <span className={`rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-mono ${color}`}>
        best {fastest.delayMs}ms
      </span>
    );
  };

  const isRuntimeTransitioning = runtimePhase === "starting" || runtimePhase === "stopping";
  const runtimeGroupTag = runtimeDebug?.top_selector_default || null;
  const runtimeLeafNodeId = runtimeDebug?.active_leaf_outbound || null;

  const runtimeResolvedNodeId = useMemo(() => {
    if (!runtimeLeafNodeId) return null;
    if (nodeMap[runtimeLeafNodeId]) return runtimeLeafNodeId;
    return null;
  }, [nodeMap, runtimeLeafNodeId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let flushTimer: number | undefined;
    const buffered: LatencyTestProgress[] = [];
    const flush = () => {
      flushTimer = undefined;
      if (buffered.length === 0) return;
      const batch = buffered.splice(0, buffered.length);
      const latest = batch[batch.length - 1];
      const previousStage = progressStageRef.current;
      const updates: Record<string, LatencyResult> = {};
      for (const progress of batch) {
        if (progress.result) updates[progress.result.nodeId] = progress.result;
      }
      const merged = { ...latenciesRef.current, ...updates };
      latenciesRef.current = merged;
      progressStageRef.current = latest.stage;
      const stageChangedToConfirmation = previousStage === "quick" && latest.stage === "confirmed";
      const terminal = latest.state === "completed" || latest.state === "cancelled";

      startTransition(() => {
        if (Object.keys(updates).length > 0) setLatencies(merged);
        setTestProgress({ ...latest, results: [] });
        setTestingNodeIds((current) => {
          if (terminal) return new Set();
          const next = new Set(current);
          for (const nodeId of Object.keys(updates)) next.delete(nodeId);
          return next;
        });
        if (stageChangedToConfirmation || terminal) applyLatencySort(merged);
        if (terminal) setTesting(false);
      });
    };
    void listen<LatencyTestProgress>("latency-test-progress", (event) => {
      const progress = event.payload;
      if (progress.profileId !== latencyProfileId) return;
      activeRunIdRef.current = progress.runId;
      buffered.push(progress);
      if (flushTimer === undefined) flushTimer = window.setTimeout(flush, 50);
    }).then((dispose) => { unlisten = dispose; });
    return () => {
      unlisten?.();
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    };
  }, [applyLatencySort, latencyProfileId]);

  useEffect(() => {
    void invoke<AppSettings>("get_app_settings").then(setLatencySettings).catch(() => setLatencySettings(null));
  }, []);

  useEffect(() => {
    activeRunIdRef.current = "";
    autoTestedKeyRef.current = "";
    latenciesRef.current = {};
    progressStageRef.current = null;
    setLatencies({});
    const originalOrder = nodes.map((node) => node.id);
    displayNodeIdsRef.current = originalOrder;
    setDisplayNodeIds(originalOrder);
    setTestProgress(null);
    setTestError(null);
  }, [latencyProfileId]);

  useEffect(() => {
    if (!latencySettings?.latency_auto_test || !latencyProfileId || nodes.length === 0 || testing) return;
    const key = `${latencyProfileId}:${nodes.map((node) => node.id).sort().join("|")}`;
    if (autoTestedKeyRef.current === key) return;
    autoTestedKeyRef.current = key;
    void testAllLatency("quick_auto").catch(() => setTesting(false));
  }, [latencyProfileId, latencySettings?.latency_auto_test, nodes, testAllLatency, testing]);

  const handleSelectNodeRow = (node: ProxyNode) => {
    setSelectedDetailNode(node);
    setShowDetail(true);
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header bar */}
      <div className="panel-card rounded-[22px] px-4 py-3">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-muted">Nodes & Groups</p>
            <h2 className="text-[1.05rem] font-semibold tracking-tight text-content">Outbound selection</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {testProgress && testing && (
              <span className="status-chip">
                {testProgress.stage === "quick" ? "Quick scan" : "Confirming"} · {testProgress.completed}/{testProgress.total} · {testProgress.succeeded} ok · {testProgress.failed} failed
              </span>
            )}
            {testing && (
              <button onClick={() => void cancelLatencyTest()}
                className="btn-secondary rounded-2xl px-3 py-1.5 text-sm text-red-500">
                Cancel
              </button>
            )}
            <button onClick={() => void testAllLatency("accurate")} disabled={testing || nodes.length === 0 || !latencyProfileId}
              className={`btn-secondary flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-sm transition-colors ${testing ? "cursor-not-allowed opacity-70" : ""}`}>
              <Activity size={14} className={testing ? "animate-pulse" : ""} />
              {testing ? "Testing..." : `Test All`}
            </button>
            <button onClick={onAdd} className="btn-primary flex items-center gap-1.5 rounded-2xl px-3.5 py-1.5 text-sm">
              <Plus size={14} />Add Node
            </button>
          </div>
        </div>
        {testError && (
          <div role="alert" className="mt-2.5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-500">
            <span className="font-semibold">Latency test failed:</span>
            <span className="min-w-0 flex-1 break-words text-content-secondary">{testError}</span>
            <button type="button" onClick={() => setTestError(null)} className="shrink-0 rounded p-0.5 hover:bg-red-500/10" title="Dismiss error">
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Nodes layout: list | detail panel */}
      <div className="grid flex-1 gap-[18px] overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(340px,480px)]">
        {/* Left: node list */}
        <div className="flex flex-col gap-4 overflow-auto">
          {/* Groups */}
          {visibleProfiles.length > 0 && (
            <div className="panel-card rounded-[20px]">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-content">Outbound Groups</h3>
                <span className="status-chip">{visibleProfiles.length}</span>
              </div>
              {visibleProfiles.map((profile) => {
                const isLiveGroup = isRunning && !isRuntimeTransitioning && runtimeGroupTag === profile.tag;
                const isSelectedGroup = selectedOutboundTag === profile.tag;
                const isSwitchingGroup = runtimePhase === "switching" && pendingOutboundTag === profile.tag;
                const showSelectedGroup = isSelectedGroup && !isLiveGroup;

                return (
                  <div key={profile.tag} className="group border-b border-border/60 last:border-b-0">
                    <div
                      onClick={() => onSelect(profile.tag)}
                      className={`flex cursor-pointer items-center gap-2 px-3.5 py-2.5 transition-all ${
                        isLiveGroup ? "bg-emerald-500/10 dark:bg-emerald-500/8" :
                        isSwitchingGroup ? "bg-primary-600/5" :
                        showSelectedGroup ? "bg-primary-600/10" : "hover:bg-muted/30"
                      }`}
                    >
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroup(profile.tag); }}
                        className="rounded-xl p-1.5 text-content-secondary hover:bg-surface-elevated hover:text-content">
                        {expandedGroups[profile.tag] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <Layers3 size={15} className={`${isSelectedGroup ? "text-primary-500" : "text-yellow-500"} shrink-0`} />
                      <span className="text-sm font-medium text-content">{profile.tag}</span>
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-yellow-500/20 dark:text-yellow-400">
                        {profile.profile_type}
                      </span>
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                        {isSwitchingGroup && <span className="status-chip status-chip-primary"><Loader2 size={10} className="animate-spin" /> Switching</span>}
                        {isLiveGroup && <span className="status-chip border-emerald-500/25 bg-emerald-500/12 text-emerald-500">Live</span>}
                        {showSelectedGroup && <span className="status-chip status-chip-primary">Selected</span>}
                        <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">{profile.outbounds.length} members</span>
                        {renderGroupLatency(profile.outbounds)}
                        <button type="button" disabled={testing || !latencyProfileId}
                          onClick={(e) => {
                            e.stopPropagation();
                            void startLatencyTest(resolveMemberNodeTags(profile.outbounds));
                          }}
                          className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-primary-500/10 hover:text-primary-500 disabled:opacity-40"
                          title="Test group latency">
                          <Activity size={13} />
                        </button>
                        {topSelectorTag === profile.tag && <span className="rounded-full bg-primary-600/15 px-2 py-0.5 text-[10px] text-primary-500">default</span>}
                        {hasConfig && topSelectorTag !== profile.tag && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveGroup(profile.tag); }}
                            className="ml-1 rounded-xl p-1.5 text-content-muted opacity-0 transition-all hover:bg-red-500/20 hover:text-red-500 group-hover:opacity-100">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedGroups[profile.tag] && (
                      <div className="border-t border-border/60 bg-muted/20 px-3 py-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {sortGroupMembers(profile.outbounds).map((memberTag) => {
                            const memberNode = nodeMap[memberTag];
                            const memberProfile = profiles.find((item) => item.tag === memberTag);
                            const isLiveNode = Boolean(isRunning && !isRuntimeTransitioning && memberNode && runtimeResolvedNodeId === memberNode.id);
                            const isSelected = selectedOutboundTag === memberTag;
                            const isSwitchingTarget = runtimePhase === "switching" && pendingOutboundTag === memberTag;
                            const showSelected = isSelected && !isLiveNode;

                            return (
                              <button key={`${profile.tag}-${memberTag}`} type="button"
                                onClick={() => { onSelect(memberTag); if (memberNode) handleSelectNodeRow(memberNode); }}
                                className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-all ${
                                  isLiveNode ? "border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/8" :
                                  showSelected ? "border-primary-500/30 bg-primary-600/10" :
                                  "border-border/60 bg-card/40 hover:border-border hover:bg-card"
                                }`}>
                                {isSwitchingTarget ? <Loader2 size={15} className="shrink-0 animate-spin text-primary-500" /> :
                                 isLiveNode ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500" /> :
                                 isSelected ? <CheckCircle2 size={15} className="shrink-0 text-primary-500" /> :
                                 memberProfile ? <Layers3 size={13} className="shrink-0 text-yellow-500" /> :
                                 <Server size={13} className="shrink-0 text-content-muted" />}
                                <span className="max-w-[12rem] truncate text-xs font-medium text-content">{memberTag}</span>
                                {memberProfile && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-yellow-500/20 dark:text-yellow-400">{memberProfile.profile_type}</span>}
                                {memberNode && <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">{PROTOCOL_LABELS[memberNode.node_type as ProtocolType] || memberNode.node_type}</span>}
                                {memberNode?.id === recommendedNodeId && <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">Best</span>}
                                {isSwitchingTarget && <span className="text-[10px] text-primary-500">Switching</span>}
                                {isLiveNode && !isSwitchingTarget && <span className="text-[10px] text-emerald-500">Live</span>}
                                {showSelected && !isSwitchingTarget && <span className="text-[10px] text-primary-500">Selected</span>}
                                {memberNode && renderLatency(memberNode.id)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Nodes */}
          {nodes.length === 0 ? (
            <div className="panel-card flex flex-col items-center justify-center rounded-[20px] py-12 text-content-muted">
              <Server size={40} className="mb-3 opacity-30" />
              <p className="text-sm">No nodes configured</p>
              <p className="mt-1 text-xs opacity-60">Add a node or import a profile to get started</p>
            </div>
          ) : (
            <div className="panel-card rounded-[20px]">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-content">Proxy Nodes</h3>
                <div className="flex items-center gap-1.5">
                  {hasLatencyResults && !testing && <span className="status-chip">Fastest first</span>}
                  <span className="status-chip">{nodes.length}</span>
                </div>
              </div>
              <div ref={nodeGridRef} className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
                {displayedNodes.map((node) => {
                  const isSelected = node.id === selectedOutboundTag;
                  const isRuntimeNode = Boolean(isRunning && !isRuntimeTransitioning && runtimeResolvedNodeId === node.id);
                  const isSwitchingTarget = runtimePhase === "switching" && pendingOutboundTag === node.id;
                  const showSelected = isSelected && !isRuntimeNode;
                  const protocolLabel = PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;

                  return (
                    <div key={node.id} data-node-id={node.id}
                      onClick={() => { onSelect(node.id); handleSelectNodeRow(node); }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onSelect(node.id);
                        handleSelectNodeRow(node);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Select ${node.name}`}
                      className={`group flex cursor-pointer items-center gap-3 rounded-[18px] border px-3 py-2.5 transition-all ${
                        isRuntimeNode ? "border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/8" :
                        showSelected ? "border-primary-500/30 bg-primary-600/10" :
                        isSwitchingTarget ? "border-primary-500/30 bg-primary-600/5" :
                        "subtle-row"
                      }`}
                      title={`${node.server}${node.port > 0 ? `:${node.port}` : ""}`}>
                      {isSwitchingTarget ? <Loader2 size={18} className="shrink-0 animate-spin text-primary-500" /> :
                       isRuntimeNode ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" /> :
                       isSelected ? <CheckCircle2 size={18} className="shrink-0 text-primary-500" /> :
                       <div className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-border-muted" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-content">{node.name}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="rounded-xl bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">{protocolLabel}</span>
                          {node.id === recommendedNodeId && <span className="rounded-xl bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">Best</span>}
                          {isSwitchingTarget && <span className="text-[10px] text-primary-500">Switching</span>}
                          {isRuntimeNode && !isSwitchingTarget && <span className="text-[10px] text-emerald-500">Live</span>}
                          {showSelected && !isSwitchingTarget && <span className="text-[10px] text-primary-500">Selected</span>}
                          {renderLatency(node.id)}
                        </div>
                      </div>
                      <div className={`flex shrink-0 items-center gap-1 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                        <button onClick={(e) => { e.stopPropagation(); void startLatencyTest([node.id]); }}
                          disabled={testing || !latencyProfileId}
                          className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-primary-500/10 hover:text-primary-500 disabled:opacity-40" title="Test latency">
                          <Activity size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onEdit(node); }}
                          className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-surface-elevated hover:text-content" title="Edit">
                          <Pencil size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onRemove(node.id); }}
                          className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-red-500/20 hover:text-red-500" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: node detail panel */}
        <div className="hidden xl:block">
          {showDetail && selectedDetailNode ? (
            <NodeDetailPanel
              node={selectedDetailNode}
              latency={latencies[selectedDetailNode.id]}
              onClose={() => setShowDetail(false)}
            />
          ) : (
            <div className="sticky top-[18px] rounded-[16px] border border-dashed border-border/70 bg-muted/20 p-8 text-center">
              <Server size={32} className="mx-auto mb-3 text-content-muted/30" />
              <p className="text-sm text-content-muted">Select a node to view details</p>
              <p className="mt-1 text-xs text-content-secondary/60">Click any node to inspect its configuration</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Node Detail Panel ── */
function NodeDetailPanel({
  node,
  latency,
  onClose,
}: {
  node: ProxyNode;
  latency: LatencyResult | undefined;
  onClose: () => void;
}) {
  const flag = guessFlag(node.name || node.id);
  const protocolLabel = PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;

  const settings = typeof node.settings === "object" && node.settings !== null
    ? (node.settings as Record<string, unknown>)
    : {};

  const transport = settings.transport != null ? String(settings.transport) : undefined;
  const hostRaw = settings.host || settings.sni || settings.server_name;
  const host = hostRaw != null ? String(hostRaw) : undefined;

  const latencyMs = latency?.status === "ok" ? latency.delayMs : null;
  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null);
  const [testingConnectivity, setTestingConnectivity] = useState(false);
  useEffect(() => {
    setConnectivity(null);
    setTestingConnectivity(false);
  }, [node.id]);
  let latencyBarPct = 0;
  let latencyColor = "from-success to-warning";
  if (latencyMs != null) {
    latencyBarPct = Math.min(100, Math.max(5, Math.round((1 - latencyMs / 1000) * 100)));
    if (latencyMs > 800) latencyColor = "from-error to-error";
    else if (latencyMs > 300) latencyColor = "from-warning to-warning";
  }

  return (
    <div className="sticky top-[18px] rounded-[16px] border border-border bg-surface/60">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-xl">{flag}</span>
          <div>
            <h3 className="text-base font-bold text-content">{node.name}</h3>
            <span className="rounded bg-blue-500/12 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
              {protocolLabel}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="rounded-xl p-1.5 text-content-muted hover:bg-surface-elevated hover:text-content">
          <X size={16} />
        </button>
      </div>

      {/* Latency */}
      <div className="border-b border-border/60 px-5 py-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted">Latency</p>
        {latencyMs != null ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-success">{latency?.stage === "quick" ? "~" : ""}{latencyMs}ms</span>
              <span className="text-xs text-content-muted">
                {latency?.stage === "quick" ? "quick estimate" : "median"} · jitter {latency?.jitterMs ?? 0}ms
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full bg-gradient-to-r ${latencyColor}`}
                style={{ width: `${latencyBarPct}%` }} />
            </div>
            <p className="mt-2 text-[10px] text-content-muted">
              {latency?.source === "runtime" ? "Runtime core" : "Probe core"} · {latency ? new Date(latency.testedAt * 1000).toLocaleTimeString() : ""}
            </p>
          </>
        ) : latency ? (
          <p className="text-sm font-semibold text-error">
            {latency.status === "timeout" ? "Timeout" : `Failed${latency.errorKind ? ` · ${latency.errorKind}` : ""}`}
          </p>
        ) : (
          <p className="text-sm text-content-muted">Not tested</p>
        )}
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4">
        <DetailKv label="Protocol" value={protocolLabel} />
        <DetailKv label="Server" value={node.server || "\u2014"} />
        <DetailKv label="Port" value={node.port > 0 ? String(node.port) : "\u2014"} />
        <DetailKv label="Transport" value={transport || "\u2014"} />
        {host && <DetailKv label="Host / SNI" value={String(host)} />}
        <DetailKv label="ID" value={node.id} />
        <DetailKv label="Status" value={latency?.status === "ok" ? "Healthy" : latency ? "Unhealthy" : "Unknown"} />
      </div>
      <div className="border-t border-border/60 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-content">TCP entry connectivity</p>
            <p className="mt-0.5 text-[10px] text-content-muted">Checks the server port only; it does not verify proxy usability.</p>
          </div>
          <button type="button" disabled={testingConnectivity || !node.server || node.port === 0}
            onClick={() => {
              setTestingConnectivity(true);
              void invoke<ConnectivityResult>("test_node_connectivity", {
                nodeId: node.id, server: node.server, port: node.port,
              }).then(setConnectivity).catch(() => setConnectivity({
                nodeId: node.id, connectMs: -1, status: "error", errorKind: "dns",
              })).finally(() => setTestingConnectivity(false));
            }}
            className="btn-secondary flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs disabled:opacity-50">
            {testingConnectivity && <Loader2 size={12} className="animate-spin" />}
            {testingConnectivity ? "Checking" : "Check TCP"}
          </button>
        </div>
        {connectivity && (
          <p className={`mt-2 text-xs font-semibold ${connectivity.status === "ok" ? "text-emerald-500" : "text-red-500"}`}>
            {connectivity.status === "ok" ? `Connected in ${connectivity.connectMs}ms` : connectivity.status === "timeout" ? "Connection timed out" : "Connection failed"}
          </p>
        )}
      </div>
    </div>
  );
}

function DetailKv({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[11px] text-content-muted">{label}</p>
      <p className="truncate text-[13px] font-semibold text-content">{value}</p>
    </div>
  );
}

export default NodeList;
