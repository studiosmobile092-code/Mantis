import {
  AlertTriangle,
  ArrowUpRight,
  Compass,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Search,
} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {
  ConceptNode,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeGrowthStats,
  RepoFile,
} from '../types/mantis';

interface ConceptGraphCanvasProps {
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  growth: KnowledgeGrowthStats;
  onQueryConcept: (label: string) => void;
  onInspectEntry: (entryId: string) => void;
  onInspectRepoFile: (filePath: string) => void;
}

type NodeKind = 'folder' | 'concept' | 'repo';

interface SimNode {
  id: string;
  label: string;
  kind: NodeKind;
  weight: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  entryIds: string[];
  filePath?: string;
}

interface SimEdge {
  source: string;
  target: string;
}

export function ConceptGraphCanvas({
  entries,
  folders,
  repoFiles,
  growth,
  onQueryConcept,
  onInspectEntry,
  onInspectRepoFile,
}: ConceptGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const [zoom, setZoom] = useState(1);

  const zoomRef = useRef(1);
  const panRef = useRef({x: 0, y: 0});
  const dragRef = useRef<{
    mode: 'none' | 'pan' | 'node';
    nodeId: string | null;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  }>({mode: 'none', nodeId: null, startX: 0, startY: 0, panX: 0, panY: 0});

  const graphData = useMemo(() => {
    const nodes: SimNode[] = [];
    const edges: SimEdge[] = [];
    const nodeIds = new Set<string>();

    const folderMap = new Map(folders.map((f) => [f.id, f]));
    const folderEntryMap = new Map<string, string[]>();
    for (const e of entries) {
      if (!e.folder_id) continue;
      const list = folderEntryMap.get(e.folder_id) || [];
      list.push(e.id);
      folderEntryMap.set(e.folder_id, list);
    }

    const activeFolders = folders.slice(0, 12);
    activeFolders.forEach((f, idx) => {
      const id = `folder:${f.id}`;
      const angle = (idx / Math.max(1, activeFolders.length)) * Math.PI * 2;
      const linked = folderEntryMap.get(f.id) || [];
      nodes.push({
        id,
        label: f.name,
        kind: 'folder',
        weight: Math.max(2, linked.length),
        x: Math.cos(angle) * 145,
        y: Math.sin(angle) * 145,
        vx: 0,
        vy: 0,
        entryIds: linked,
      });
      nodeIds.add(id);
    });

    const topConcepts: ConceptNode[] = growth.topConcepts.slice(0, 22);
    topConcepts.forEach((c, idx) => {
      const id = `concept:${c.label}`;
      const angle = (idx / Math.max(1, topConcepts.length)) * Math.PI * 2 + 0.3;
      nodes.push({
        id,
        label: c.label,
        kind: 'concept',
        weight: Math.max(1, c.count),
        x: Math.cos(angle) * (65 + (idx % 3) * 38),
        y: Math.sin(angle) * (65 + (idx % 3) * 38),
        vx: 0,
        vy: 0,
        entryIds: c.entryIds,
      });
      nodeIds.add(id);

      // Connect concept to its entries' folders
      const seenFolders = new Set<string>();
      for (const eid of c.entryIds.slice(0, 5)) {
        const entry = entries.find((e) => e.id === eid);
        if (entry?.folder_id && folderMap.has(entry.folder_id)) {
          const fid = `folder:${entry.folder_id}`;
          if (nodeIds.has(fid) && !seenFolders.has(fid)) {
            seenFolders.add(fid);
            edges.push({source: id, target: fid});
          }
        }
      }
    });

    // Concept-to-concept co-occurrence links
    for (const c of topConcepts) {
      const src = `concept:${c.label}`;
      for (const rel of c.related) {
        const tgt = `concept:${rel}`;
        if (nodeIds.has(tgt) && src < tgt) {
          edges.push({source: src, target: tgt});
        }
      }
    }

    // Top repo files anchored on outer ring
    const sampleRepo = repoFiles.slice(0, 8);
    sampleRepo.forEach((rf, idx) => {
      const id = `repo:${rf.path}`;
      const shortName = rf.path.split('/').pop() || rf.path;
      const angle = (idx / Math.max(1, sampleRepo.length)) * Math.PI * 2 + 0.15;
      nodes.push({
        id,
        label: shortName,
        kind: 'repo',
        weight: 2,
        x: Math.cos(angle) * 215,
        y: Math.sin(angle) * 215,
        vx: 0,
        vy: 0,
        entryIds: [],
        filePath: rf.path,
      });
      nodeIds.add(id);

      const lowerContent = `${rf.path} ${rf.content.slice(0, 800)}`.toLowerCase();
      for (const c of topConcepts.slice(0, 12)) {
        if (lowerContent.includes(c.label.toLowerCase())) {
          edges.push({source: id, target: `concept:${c.label}`});
        }
      }
    });

    // Orphan notes check (entries missing folder or tags/links)
    const orphans = entries.filter(
      (e) => !e.folder_id || (e.tags.length === 0 && e.content.trim().length < 40),
    );

    return {nodes, edges, orphans};
  }, [entries, folders, repoFiles, growth.topConcepts]);

  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const energyRef = useRef(1);

  useEffect(() => {
    simNodesRef.current = graphData.nodes.map((n) => ({...n}));
    simEdgesRef.current = graphData.edges;
    energyRef.current = 1.0;
    setIsSettled(false);
    setSelectedNodeId((prev) =>
      prev && graphData.nodes.some((n) => n.id === prev)
        ? prev
        : graphData.nodes[0]?.id || null,
    );
  }, [graphData]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId = 0;
    let frameCount = 0;

    const renderFrame = () => {
      rafId = window.requestAnimationFrame(renderFrame);
      if (document.hidden) return;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.floor(rect.width * dpr);
      const targetH = Math.floor(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const nodes = simNodesRef.current;
      const edges = simEdgesRef.current;
      const nodeById = new Map(nodes.map((n) => [n.id, n]));

      // Force simulation step when active & unsettled
      if (!isPaused && energyRef.current > 0.015 && nodes.length > 0) {
        let totalKinetic = 0;
        const repulsion = 2100;
        const springLen = 88;
        const springK = 0.025;
        const centerGravity = 0.012;

        for (let i = 0; i < nodes.length; i += 1) {
          const a = nodes[i];
          if (dragRef.current.mode === 'node' && dragRef.current.nodeId === a.id) continue;

          let fx = -a.x * centerGravity;
          let fy = -a.y * centerGravity;

          for (let j = 0; j < nodes.length; j += 1) {
            if (i === j) continue;
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const distSq = dx * dx + dy * dy + 25;
            const force = repulsion / distSq;
            const dist = Math.sqrt(distSq);
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }

          a.vx = (a.vx + fx * 0.04) * 0.84;
          a.vy = (a.vy + fy * 0.04) * 0.84;
        }

        for (const edge of edges) {
          const s = nodeById.get(edge.source);
          const t = nodeById.get(edge.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const delta = (dist - springLen) * springK;
          const ox = (dx / dist) * delta;
          const oy = (dy / dist) * delta;
          if (!(dragRef.current.mode === 'node' && dragRef.current.nodeId === s.id)) {
            s.vx += ox;
            s.vy += oy;
          }
          if (!(dragRef.current.mode === 'node' && dragRef.current.nodeId === t.id)) {
            t.vx -= ox;
            t.vy -= oy;
          }
        }

        for (const n of nodes) {
          if (dragRef.current.mode === 'node' && dragRef.current.nodeId === n.id) continue;
          n.x += n.vx;
          n.y += n.vy;
          totalKinetic += Math.abs(n.vx) + Math.abs(n.vy);
        }

        energyRef.current = totalKinetic / Math.max(1, nodes.length);
        frameCount += 1;
        if (energyRef.current <= 0.015 || frameCount > 360) {
          energyRef.current = 0;
          setIsSettled(true);
        }
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Subtle architectural grid
      const cs = getComputedStyle(document.documentElement);
      const borderColor = cs.getPropertyValue('--mantis-line').trim() || '#1c2538';
      const inkColor = cs.getPropertyValue('--mantis-ink').trim() || '#f1f5f9';
      const mutedColor = cs.getPropertyValue('--mantis-ink-muted').trim() || '#94a3b8';
      const accentColor = cs.getPropertyValue('--mantis-accent').trim() || '#10b981';

      const cx = rect.width / 2 + panRef.current.x;
      const cy = rect.height / 2 + panRef.current.y;
      const z = zoomRef.current;

      ctx.translate(cx, cy);
      ctx.scale(z, z);

      const q = filterText.trim().toLowerCase();

      // Edges
      ctx.lineWidth = 1;
      for (const edge of edges) {
        const s = nodeById.get(edge.source);
        const t = nodeById.get(edge.target);
        if (!s || !t) continue;
        const highlighted =
          selectedNodeId === s.id || selectedNodeId === t.id;
        ctx.strokeStyle = highlighted ? accentColor : borderColor;
        ctx.globalAlpha = highlighted ? 0.78 : 0.45;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nodes
      for (const n of nodes) {
        const isSelected = n.id === selectedNodeId;
        const matchesFilter = !q || n.label.toLowerCase().includes(q);
        const radius =
          n.kind === 'folder'
            ? 8 + Math.min(8, n.weight * 0.7)
            : n.kind === 'repo'
              ? 7
              : 5 + Math.min(7, n.weight * 0.6);

        ctx.globalAlpha = matchesFilter ? 1 : 0.22;

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        if (n.kind === 'folder') {
          ctx.fillStyle = isSelected ? accentColor : '#10b98133';
          ctx.strokeStyle = accentColor;
        } else if (n.kind === 'repo') {
          ctx.fillStyle = isSelected ? '#60a5fa' : '#3b82f630';
          ctx.strokeStyle = '#60a5fa';
        } else {
          ctx.fillStyle = isSelected ? accentColor : '#161f30';
          ctx.strokeStyle = isSelected ? '#ffffff' : '#475569';
        }
        ctx.lineWidth = isSelected ? 2 : 1.2;
        ctx.fill();
        ctx.stroke();

        // Crisp label
        ctx.font = n.kind === 'folder' ? '600 11px Inter, system-ui, sans-serif' : '500 10px ui-monospace, monospace';
        ctx.fillStyle = isSelected || n.kind === 'folder' ? inkColor : mutedColor;
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + radius + 12);
      }

      ctx.restore();
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPaused, selectedNodeId, filterText]);

  function screenToWorld(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return {x: 0, y: 0};
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left - rect.width / 2 - panRef.current.x;
    const sy = clientY - rect.top - rect.height / 2 - panRef.current.y;
    return {x: sx / zoomRef.current, y: sy / zoomRef.current};
  }

  function findHitNode(wx: number, wy: number): SimNode | null {
    for (let i = simNodesRef.current.length - 1; i >= 0; i -= 1) {
      const n = simNodesRef.current[i];
      const dx = n.x - wx;
      const dy = n.y - wy;
      if (dx * dx + dy * dy <= 280) {
        return n;
      }
    }
    return null;
  }

  const selectedNode = useMemo(
    () => graphData.nodes.find((n) => n.id === selectedNodeId) || null,
    [graphData.nodes, selectedNodeId],
  );

  const selectedEntries = useMemo(() => {
    if (!selectedNode) return [];
    const set = new Set(selectedNode.entryIds);
    return entries.filter((e) => set.has(e.id));
  }, [selectedNode, entries]);

  return (
    <div className="space-y-4">
      {/* Graph Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-accent-text" />
          <h2 className="text-sm font-semibold text-ink">Knowledge &amp; Code Topology</h2>
          <span className="font-mono text-xs tabular-nums text-ink-subtle">
            {graphData.nodes.length} nodes · {graphData.edges.length} links
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter node..."
              aria-label="Filter concept graph node"
              className="min-h-[36px] w-40 rounded-md border border-line bg-inset pr-2.5 pl-8 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              if (isPaused || isSettled) {
                energyRef.current = 0.85;
                setIsSettled(false);
                setIsPaused(false);
              } else {
                setIsPaused(true);
              }
            }}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-muted hover:border-line-strong hover:text-ink"
          >
            {isPaused || isSettled ? (
              <>
                <Play className="h-3.5 w-3.5 text-accent-text" />
                <span>{isSettled ? 'Re-layout' : 'Resume'}</span>
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Pause</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.2).toFixed(1))))}
            aria-label="Zoom in"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-line bg-surface text-ink-muted hover:text-ink"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.2).toFixed(1))))}
            aria-label="Zoom out"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-line bg-surface text-ink-muted hover:text-ink"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              panRef.current = {x: 0, y: 0};
              setZoom(1);
              energyRef.current = 0.9;
              setIsSettled(false);
              setIsPaused(false);
            }}
            title="Reset viewport"
            aria-label="Reset viewport"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-line bg-surface text-ink-muted hover:text-ink"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Split: Canvas + Inspector Drawer */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div
          ref={containerRef}
          className="relative h-[420px] w-full overflow-hidden rounded-lg border border-line bg-inset"
        >
          {graphData.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-muted">
              No concepts or folders indexed yet. Teach rules, ingest links, or sync a GitHub repo to populate the live graph.
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="h-full w-full cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={(e) => {
                const w = screenToWorld(e.clientX, e.clientY);
                const hit = findHitNode(w.x, w.y);
                if (hit) {
                  setSelectedNodeId(hit.id);
                  dragRef.current = {
                    mode: 'node',
                    nodeId: hit.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    panX: panRef.current.x,
                    panY: panRef.current.y,
                  };
                } else {
                  dragRef.current = {
                    mode: 'pan',
                    nodeId: null,
                    startX: e.clientX,
                    startY: e.clientY,
                    panX: panRef.current.x,
                    panY: panRef.current.y,
                  };
                }
                (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (dragRef.current.mode === 'none') return;
                if (dragRef.current.mode === 'pan') {
                  panRef.current = {
                    x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
                    y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
                  };
                } else if (dragRef.current.mode === 'node' && dragRef.current.nodeId) {
                  const w = screenToWorld(e.clientX, e.clientY);
                  const target = simNodesRef.current.find((n) => n.id === dragRef.current.nodeId);
                  if (target) {
                    target.x = w.x;
                    target.y = w.y;
                    target.vx = 0;
                    target.vy = 0;
                  }
                }
              }}
              onPointerUp={() => {
                dragRef.current.mode = 'none';
                dragRef.current.nodeId = null;
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                setZoom((z) => Math.min(2.2, Math.max(0.5, Number((z + delta).toFixed(2)))));
              }}
            />
          )}

          {/* Legend */}
          <div className="pointer-events-none absolute bottom-2.5 left-3 flex flex-wrap items-center gap-3 rounded border border-line bg-canvas/90 px-2.5 py-1 font-mono text-[10px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              Folder
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
              Concept
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
              Repo File
            </span>
          </div>
        </div>

        {/* Right Node Inspector */}
        <aside className="flex flex-col justify-between gap-4 rounded-lg border border-line bg-surface p-3.5">
          {selectedNode ? (
            <div className="space-y-3">
              <div className="border-b border-line pb-2.5">
                <div className="font-mono text-[10px] tracking-wide text-accent-text uppercase">
                  {selectedNode.kind} Node
                </div>
                <h3 className="mt-0.5 truncate text-sm font-semibold text-ink">
                  {selectedNode.filePath || selectedNode.label}
                </h3>
                <div className="mt-1 font-mono text-[11px] tabular-nums text-ink-muted">
                  {selectedNode.kind === 'repo'
                    ? 'Indexed GitHub Source'
                    : `${selectedEntries.length} linked memory ${
                        selectedEntries.length === 1 ? 'entry' : 'entries'
                      }`}
                </div>
              </div>

              {selectedNode.kind === 'repo' && selectedNode.filePath ? (
                <button
                  type="button"
                  onClick={() => onInspectRepoFile(selectedNode.filePath!)}
                  className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-hover"
                >
                  <span>Inspect Source File</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onQueryConcept(selectedNode.label)}
                  className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-2 text-xs font-medium text-accent-text hover:border-accent-border"
                >
                  <span>Query &quot;{selectedNode.label}&quot; in Stream</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}

              {selectedEntries.length > 0 && (
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {selectedEntries.slice(0, 8).map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onInspectEntry(entry.id)}
                      className="block w-full rounded border border-line bg-inset px-2.5 py-2 text-left transition-colors hover:border-line-strong"
                    >
                      <div className="truncate text-xs font-medium text-ink">{entry.title}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-muted">
                        {entry.content}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              Click or drag any node to inspect its connected memories and cross-links.
            </p>
          )}

          {graphData.orphans.length > 0 && (
            <div className="border-t border-line pt-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="tabular-nums">
                  {graphData.orphans.length} unlinked / thin notes
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
                Add tags or assign folders in Memory Explorer to tighten graph recall.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
