import { create } from 'zustand'
import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from 'reactflow'
import type { CallEdge, FunctionNode, Note, Panel, ParseResult, UiState } from './types'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation } from 'd3-force'

const defaultCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract CallGraphComplex {
    uint256 public total;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier validAmount(uint256 x) {
        require(x > 0, "invalid amount");
        _;
    }

    /* ========= ENTRY POINTS ========= */

    function entryA(uint256 x) external validAmount(x) {
        _routeA(x);
    }

    function entryB(uint256 x) public {
        if (x % 2 == 0) {
            publicAdd(x);
        } else {
            publicSub(x);
        }
    }

    function entryC() external onlyOwner {
        _adminFlow();
    }

    /* ========= PUBLIC FUNCTIONS ========= */

    function publicAdd(uint256 x) public validAmount(x) {
        total += x;
        _postProcess();
    }

    function publicSub(uint256 x) public {
        _preCheck(x);
        total -= x;
        _postProcess();
    }

    function publicReset() public onlyOwner {
        total = 0;
    }

    /* ========= INTERNAL ROUTES ========= */

    function _routeA(uint256 x) internal {
        if (x > 100) {
            _routeB(x);
        } else {
            publicAdd(x);
        }
    }

    function _routeB(uint256 x) internal {
        _routeC(x / 2);
    }

    function _routeC(uint256 x) internal {
        total += x;
        _postProcess();
    }

    /* ========= INTERNAL HELPERS ========= */

    function _preCheck(uint256 x) internal pure {
        require(x < 1000, "too large");
    }

    function _postProcess() internal {
        if (total > 500) {
            _normalize();
        }
    }

    function _normalize() internal {
        total = total / 2;
    }

    function _checkOwner() internal view {
        require(msg.sender == owner, "not owner");
    }

    /* ========= ADMIN FLOW ========= */

    function _adminFlow() internal {
        _sync();
        _finalize();
    }

    function _sync() internal {
        total += 10;
    }

    function _finalize() internal {
        total *= 2;
    }
}

`

function createPanel(name: string): Panel {
  return {
    id: crypto.randomUUID(),
    name,
    code: defaultCode,
    nodes: [],
    edges: [],
    notesByNodeId: {},
    blacklistedNodeIds: [],
    trashedNodeIds: [],
    minimap: { x: 16, y: 16 },
  }
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function canMutate(sharePermission: UiState['sharePermission']): boolean {
  return sharePermission === 'normal'
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function hash01(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

function radialPosition(index: number, id: string): { x: number; y: number } {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const t = index * goldenAngle
  const jitter = hash01(id)
  const radius = 90 + Math.sqrt(index) * 56 + jitter * 42
  const x = Math.cos(t) * radius + (jitter - 0.5) * 26
  const y = Math.sin(t) * radius + (jitter - 0.5) * 26
  return { x, y }
}

function mergeGraph(panel: Panel, parsed: ParseResult): Pick<Panel, 'nodes' | 'edges' | 'trashedNodeIds'> {
  const existingById = new Map(panel.nodes.map((n) => [n.id, n]))
  const blacklisted = new Set(panel.blacklistedNodeIds)
  const trashed = new Set(panel.trashedNodeIds)

  const nextNodes: FunctionNode[] = []
  const presentIds: string[] = []
  for (const fn of parsed.functions) {
    const id = fn.id || `${fn.contractName}.${fn.functionName}`
    presentIds.push(id)

    const existing = existingById.get(id)
    const hasNote = Boolean(panel.notesByNodeId[id]?.content?.trim())
    const isBlacklisted = blacklisted.has(id)
    const node: FunctionNode = existing
      ? {
          ...existing,
          id,
          data: {
            ...existing.data,
            label: `${fn.functionName}()`,
            contractName: fn.contractName,
            functionName: fn.functionName,
            visibility: fn.visibility,
            isBlacklisted,
            hasNote,
          },
        }
      : {
          id,
          type: 'function',
          position: radialPosition(nextNodes.length, id),
          data: {
            label: `${fn.functionName}()`,
            contractName: fn.contractName,
            functionName: fn.functionName,
            visibility: fn.visibility,
            isBlacklisted,
            hasNote,
          },
        }

    nextNodes.push(node)
  }

  const present = new Set(presentIds)
  const nextTrashed = uniq([...panel.trashedNodeIds, ...Array.from(existingById.keys()).filter((id) => !present.has(id))])
  for (const id of nextTrashed) trashed.add(id)

  for (const [id, existing] of existingById) {
    if (present.has(id)) continue
    nextNodes.push(existing)
  }

  const nextEdges: CallEdge[] = []
  for (const e of parsed.edges) {
    if (!present.has(e.source) || !present.has(e.target)) continue
    nextEdges.push({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: 'bezier',
    })
  }

  return { nodes: nextNodes, edges: nextEdges, trashedNodeIds: nextTrashed }
}

function applyForceLayout(nodes: FunctionNode[], edges: CallEdge[], fixedIds: Set<string> | null): FunctionNode[] {
  const simNodes = nodes.map((n) => {
    const isFixed = fixedIds?.has(n.id) ?? false
    return {
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      fx: isFixed ? n.position.x : undefined,
      fy: isFixed ? n.position.y : undefined,
    }
  })
  const simLinks = edges.map((e) => ({ source: e.source, target: e.target }))

  const cx = 0
  const cy = 0
  const targetRadius = Math.min(520, 180 + Math.sqrt(simNodes.length) * 70)

  const sim = forceSimulation(
    simNodes as unknown as { id: string; x: number; y: number; fx?: number; fy?: number }[],
  )
    .force('charge', forceManyBody().strength(-420))
    .force('center', forceCenter(cx, cy))
    .force('radial', forceRadial(targetRadius, cx, cy).strength(0.05))
    .force('collide', forceCollide(150).strength(1))
    .force(
      'link',
      forceLink(simLinks)
        .id((d: unknown) => (d as { id: string }).id)
        .distance(160)
        .strength(0.9),
    )
    .stop()

  for (let i = 0; i < 520; i++) sim.tick()
  sim.stop()

  const byId = new Map(simNodes.map((n) => [n.id, n]))
  return nodes.map((n) => {
    const p = byId.get(n.id)
    if (!p) return n
    return { ...n, position: { x: p.x, y: p.y } }
  })
}

function computeHighlight(panel: Panel, selectedNodeId: string | null): {
  highlightNodeIds: Set<string>
  highlightEdgeIds: Set<string>
} {
  if (!selectedNodeId) return { highlightNodeIds: new Set(), highlightEdgeIds: new Set() }

  const blacklisted = new Set(panel.blacklistedNodeIds)
  const trashed = new Set(panel.trashedNodeIds)
  if (blacklisted.has(selectedNodeId) || trashed.has(selectedNodeId)) {
    return { highlightNodeIds: new Set(), highlightEdgeIds: new Set() }
  }

  const forward = new Map<string, string[]>()
  const backward = new Map<string, string[]>()
  for (const e of panel.edges) {
    if (blacklisted.has(e.source) || blacklisted.has(e.target)) continue
    if (trashed.has(e.source) || trashed.has(e.target)) continue
    forward.set(e.source, [...(forward.get(e.source) ?? []), e.target])
    backward.set(e.target, [...(backward.get(e.target) ?? []), e.source])
  }

  const highlightNodeIds = new Set<string>([selectedNodeId])
  const queue: string[] = [selectedNodeId]
  while (queue.length) {
    const current = queue.shift()!
    const outs = forward.get(current) ?? []
    const ins = backward.get(current) ?? []
    for (const next of [...outs, ...ins]) {
      if (highlightNodeIds.has(next)) continue
      highlightNodeIds.add(next)
      queue.push(next)
    }
  }

  const highlightEdgeIds = new Set<string>()
  for (const e of panel.edges) {
    if (blacklisted.has(e.source) || blacklisted.has(e.target)) continue
    if (trashed.has(e.source) || trashed.has(e.target)) continue
    if (highlightNodeIds.has(e.source) && highlightNodeIds.has(e.target)) highlightEdgeIds.add(e.id)
  }

  return { highlightNodeIds, highlightEdgeIds }
}

export type AppState = {
  activePanelId: string
  panels: Panel[]
  ui: UiState
  highlightNodeIds: Set<string>
  highlightEdgeIds: Set<string>
  recentNodeIds: Set<string>
  recentEdgeIds: Set<string>
  lastSyncStats: {
    addedNodes: number
    addedEdges: number
    removedNodes: number
    removedEdges: number
    at: number
  } | null

  actions: {
    hydratePanels: (panels: Panel[], activePanelId: string) => void

    setLeftOpen: (open: boolean) => void
    setRightOpen: (open: boolean) => void
    setSharePermission: (permission: UiState['sharePermission']) => void

    createPanel: () => void
    duplicatePanel: (panelId: string) => void
    deletePanel: (panelId: string) => void
    setActivePanelId: (panelId: string) => void
    renamePanel: (panelId: string, name: string) => void

    setCode: (code: string) => void
    syncFromParseResult: (result: ParseResult) => void

    onNodesChange: (changes: NodeChange[]) => void
    onEdgesChange: (changes: EdgeChange[]) => void

    setSelectedNodeId: (nodeId: string | null) => void
    focusNode: (nodeId: string) => void

    openContextMenu: (nodeId: string, x: number, y: number) => void
    closeContextMenu: () => void

    openNoteEditor: (nodeId: string) => void
    closeNoteEditor: () => void
    upsertNote: (note: Note) => void
    deleteNote: (nodeId: string) => void
    deleteNoteInPanel: (panelId: string, nodeId: string) => void

    toggleBlacklist: (nodeId: string) => void
    trashNode: (nodeId: string) => void
    restoreNode: (nodeId: string) => void
    setMinimapPosition: (x: number, y: number) => void
  }
}

const initialPanel = createPanel('Default')
let recentClearTimer: number | null = null

export const useAppStore = create<AppState>((set, get) => ({
  activePanelId: initialPanel.id,
  panels: [initialPanel],
  ui: {
    leftOpen: true,
    rightOpen: false,
    sharePermission: 'normal',
    contextMenu: null,
    noteEditor: null,
    selectedNodeId: null,
    focusNodeId: null,
    focusNonce: 0,
  },
  highlightNodeIds: new Set(),
  highlightEdgeIds: new Set(),
  recentNodeIds: new Set(),
  recentEdgeIds: new Set(),
  lastSyncStats: null,
  actions: {
    hydratePanels: (panels, activePanelId) => {
      const normalized = panels.map((p) => ({ ...p, nodes: dedupeById(p.nodes), edges: dedupeById(p.edges) }))
      set({ panels: normalized, activePanelId })
      const panel = normalized.find((p) => p.id === activePanelId) ?? normalized[0]
      const { highlightNodeIds, highlightEdgeIds } = computeHighlight(panel, get().ui.selectedNodeId)
      set({ highlightNodeIds, highlightEdgeIds, recentNodeIds: new Set(), recentEdgeIds: new Set(), lastSyncStats: null })
    },

    setLeftOpen: (open) => set((s) => ({ ui: { ...s.ui, leftOpen: open } })),
    setRightOpen: (open) => set((s) => ({ ui: { ...s.ui, rightOpen: open } })),
    setSharePermission: (permission) => set((s) => ({ ui: { ...s.ui, sharePermission: permission } })),

    createPanel: () => {
      if (!canMutate(get().ui.sharePermission)) return
      const panel = createPanel(`Panel ${get().panels.length + 1}`)
      set((s) => ({ panels: [...s.panels, panel], activePanelId: panel.id }))
    },
    duplicatePanel: (panelId) => {
      if (!canMutate(get().ui.sharePermission)) return
      const source = get().panels.find((p) => p.id === panelId)
      if (!source) return
      const copy: Panel = {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} Copy`,
        nodes: source.nodes.map((n) => ({ ...n })),
        edges: source.edges.map((e) => ({ ...e })),
        notesByNodeId: { ...source.notesByNodeId },
        blacklistedNodeIds: [...source.blacklistedNodeIds],
        trashedNodeIds: [...source.trashedNodeIds],
      }
      set((s) => ({ panels: [...s.panels, copy], activePanelId: copy.id }))
    },
    deletePanel: (panelId) => {
      if (!canMutate(get().ui.sharePermission)) return
      set((s) => {
        if (s.panels.length <= 1) return s
        const nextPanels = s.panels.filter((p) => p.id !== panelId)
        const nextActive = s.activePanelId === panelId ? nextPanels[0].id : s.activePanelId
        return { ...s, panels: nextPanels, activePanelId: nextActive }
      })
    },
    setActivePanelId: (panelId) => {
      set({ activePanelId: panelId })
      const panel = get().panels.find((p) => p.id === panelId)
      if (!panel) return
      const { highlightNodeIds, highlightEdgeIds } = computeHighlight(panel, get().ui.selectedNodeId)
      set({ highlightNodeIds, highlightEdgeIds })
    },
    renamePanel: (panelId, name) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return { panels: s.panels.map((p) => (p.id === panelId ? { ...p, name } : p)) }
      }),

    setCode: (code) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return { panels: s.panels.map((p) => (p.id === s.activePanelId ? { ...p, code } : p)) }
      }),
    syncFromParseResult: (result) => {
      let recentNodeIds = new Set<string>()
      let recentEdgeIds = new Set<string>()
      let lastSyncStats: AppState['lastSyncStats'] = null
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        const activeBefore = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
        const prevNodeIds = new Set(activeBefore.nodes.map((n) => n.id))
        const prevEdgeIds = new Set(activeBefore.edges.map((e) => e.id))
        const prevTrashed = new Set(activeBefore.trashedNodeIds)
        const nextPanels = s.panels.map((p) => {
          if (p.id !== s.activePanelId) return p
          const merged = mergeGraph(p, result)
          if (merged.nodes.length === 0) return { ...p, ...merged }

          const existingIds = new Set(p.nodes.map((n) => n.id))
          const hasExisting = existingIds.size > 0
          const hasNew = merged.nodes.some((n) => !existingIds.has(n.id))
          if (!hasExisting) {
            const nodes = applyForceLayout(merged.nodes, merged.edges, null)
            return { ...p, ...merged, nodes }
          }
          if (!hasNew) return { ...p, ...merged }

          const layouted = applyForceLayout(merged.nodes, merged.edges, existingIds)
          const layoutedById = new Map(layouted.map((n) => [n.id, n.position]))
          const nodes = merged.nodes.map((n) => {
            if (existingIds.has(n.id)) return n
            const pos = layoutedById.get(n.id)
            return pos ? { ...n, position: pos } : n
          })
          return { ...p, ...merged, nodes }
        })
        const active = nextPanels.find((p) => p.id === s.activePanelId) ?? nextPanels[0]
        const nextNodeIds = new Set(active.nodes.map((n) => n.id))
        const nextEdgeIds = new Set(active.edges.map((e) => e.id))
        recentNodeIds = new Set([...nextNodeIds].filter((id) => !prevNodeIds.has(id)))
        recentEdgeIds = new Set([...nextEdgeIds].filter((id) => !prevEdgeIds.has(id)))
        const newlyTrashed = active.trashedNodeIds.filter((id) => !prevTrashed.has(id)).length
        const removedEdges = [...prevEdgeIds].filter((id) => !nextEdgeIds.has(id)).length
        lastSyncStats = {
          addedNodes: recentNodeIds.size,
          addedEdges: recentEdgeIds.size,
          removedNodes: newlyTrashed,
          removedEdges,
          at: Date.now(),
        }
        const { highlightNodeIds, highlightEdgeIds } = computeHighlight(active, s.ui.selectedNodeId)
        return {
          ...s,
          panels: nextPanels,
          highlightNodeIds,
          highlightEdgeIds,
          recentNodeIds,
          recentEdgeIds,
          lastSyncStats,
        }
      })
      if (recentClearTimer) window.clearTimeout(recentClearTimer)
      recentClearTimer = window.setTimeout(() => {
        set({ recentNodeIds: new Set(), recentEdgeIds: new Set() })
      }, 2400)
    },

    onNodesChange: (changes) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return {
          panels: s.panels.map((p) =>
            p.id === s.activePanelId ? { ...p, nodes: applyNodeChanges(changes, p.nodes) } : p,
          ),
        }
      }),
    onEdgesChange: (changes) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return {
          panels: s.panels.map((p) =>
            p.id === s.activePanelId ? { ...p, edges: applyEdgeChanges(changes, p.edges) } : p,
          ),
        }
      }),

    setSelectedNodeId: (nodeId) =>
      set((s) => {
        const panel = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
        const { highlightNodeIds, highlightEdgeIds } = computeHighlight(panel, nodeId)
        return { ...s, ui: { ...s.ui, selectedNodeId: nodeId }, highlightNodeIds, highlightEdgeIds }
      }),

    focusNode: (nodeId) =>
      set((s) => ({
        ui: { ...s.ui, focusNodeId: nodeId, focusNonce: s.ui.focusNonce + 1 },
      })),

    openContextMenu: (nodeId, x, y) => set((s) => ({ ui: { ...s.ui, contextMenu: { nodeId, x, y } } })),
    closeContextMenu: () => set((s) => ({ ui: { ...s.ui, contextMenu: null } })),

    openNoteEditor: (nodeId) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return { ui: { ...s.ui, noteEditor: { nodeId } } }
      }),
    closeNoteEditor: () => set((s) => ({ ui: { ...s.ui, noteEditor: null } })),
    upsertNote: (note) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return {
          panels: s.panels.map((p) => {
            if (p.id !== s.activePanelId) return p
            const notesByNodeId = { ...p.notesByNodeId, [note.nodeId]: note }
            const nodes = p.nodes.map((n) =>
              n.id === note.nodeId ? { ...n, data: { ...n.data, hasNote: Boolean(note.content.trim()) } } : n,
            )
            return { ...p, notesByNodeId, nodes }
          }),
        }
      }),
    deleteNote: (nodeId) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return {
          panels: s.panels.map((p) => {
            if (p.id !== s.activePanelId) return p
            const rest = { ...p.notesByNodeId }
            delete rest[nodeId]
            const nodes = p.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, hasNote: false } } : n,
            )
            return { ...p, notesByNodeId: rest, nodes }
          }),
        }
      }),
    deleteNoteInPanel: (panelId, nodeId) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return {
          panels: s.panels.map((p) => {
            if (p.id !== panelId) return p
            const rest = { ...p.notesByNodeId }
            delete rest[nodeId]
            const nodes = p.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, hasNote: false } } : n,
            )
            return { ...p, notesByNodeId: rest, nodes }
          }),
        }
      }),

    toggleBlacklist: (nodeId) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        const activeBefore = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
        const wasBlacklisted = activeBefore.blacklistedNodeIds.includes(nodeId)
        const nextPanels = s.panels.map((p) => {
          if (p.id !== s.activePanelId) return p
          const blacklistedNodeIds = wasBlacklisted
            ? p.blacklistedNodeIds.filter((id) => id !== nodeId)
            : uniq([...p.blacklistedNodeIds, nodeId])

          const nodes = p.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, isBlacklisted: !wasBlacklisted } } : n,
          )
          return { ...p, blacklistedNodeIds, nodes }
        })
        const active = nextPanels.find((p) => p.id === s.activePanelId) ?? nextPanels[0]
        const nextSelectedNodeId = s.ui.selectedNodeId === nodeId && !wasBlacklisted ? null : s.ui.selectedNodeId
        const { highlightNodeIds, highlightEdgeIds } = computeHighlight(active, nextSelectedNodeId)
        return {
          ...s,
          panels: nextPanels,
          ui: nextSelectedNodeId === s.ui.selectedNodeId ? s.ui : { ...s.ui, selectedNodeId: nextSelectedNodeId },
          highlightNodeIds,
          highlightEdgeIds,
        }
      }),

    trashNode: (nodeId) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return {
          panels: s.panels.map((p) => {
            if (p.id !== s.activePanelId) return p
            const trashedNodeIds = uniq([...p.trashedNodeIds, nodeId])
            return { ...p, trashedNodeIds }
          }),
          ui: { ...s.ui, contextMenu: null, selectedNodeId: s.ui.selectedNodeId === nodeId ? null : s.ui.selectedNodeId },
        }
      }),

    restoreNode: (nodeId) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return {
          panels: s.panels.map((p) => {
            if (p.id !== s.activePanelId) return p
            return { ...p, trashedNodeIds: p.trashedNodeIds.filter((id) => id !== nodeId) }
          }),
        }
      }),

    setMinimapPosition: (x, y) =>
      set((s) => {
        if (!canMutate(s.ui.sharePermission)) return s
        return { panels: s.panels.map((p) => (p.id === s.activePanelId ? { ...p, minimap: { x, y } } : p)) }
      }),
  },
}))

export function getActivePanel(state: Pick<AppState, 'activePanelId' | 'panels'>): Panel {
  return state.panels.find((p) => p.id === state.activePanelId) ?? state.panels[0]
}
