import { useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, { Background, Controls, ReactFlowProvider, useReactFlow } from 'reactflow'
import { useShallow } from 'zustand/shallow'
import { useAppStore } from '../app/store'
import { FunctionNode } from './FunctionNode'
import { MovableMiniMap } from './MovableMiniMap'
import { ContextMenu } from './ContextMenu'

const nodeTypes = { function: FunctionNode }

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  const rotation = direction === 'left' ? 180 : 0
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GraphInner() {
  const { fitView, getNode, setCenter } = useReactFlow()
  const { panel, ui, highlightNodeIds, highlightEdgeIds, recentNodeIds, recentEdgeIds, actions } = useAppStore(
    useShallow((s) => {
      const panel = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
      return {
        panel,
        ui: s.ui,
        highlightNodeIds: s.highlightNodeIds,
        highlightEdgeIds: s.highlightEdgeIds,
        recentNodeIds: s.recentNodeIds,
        recentEdgeIds: s.recentEdgeIds,
        actions: s.actions,
      }
    }),
  )

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const blacklisted = useMemo(() => new Set(panel.blacklistedNodeIds), [panel.blacklistedNodeIds])
  const trashed = useMemo(() => new Set(panel.trashedNodeIds), [panel.trashedNodeIds])

  const visibleNodes = useMemo(
    () => {
      const seen = new Set<string>()
      return panel.nodes.filter((n) => {
        if (blacklisted.has(n.id) || trashed.has(n.id)) return false
        if (seen.has(n.id)) return false
        seen.add(n.id)
        return true
      })
    },
    [blacklisted, panel.nodes, trashed],
  )
  const visibleEdges = useMemo(
    () => panel.edges.filter((e) => !blacklisted.has(e.source) && !blacklisted.has(e.target) && !trashed.has(e.source) && !trashed.has(e.target)),
    [blacklisted, panel.edges, trashed],
  )

  const decoratedNodes = useMemo(() => {
    const hasHighlight = ui.selectedNodeId && highlightNodeIds.size > 0
    return visibleNodes.map((n) => {
      const shouldFade = hasHighlight && !highlightNodeIds.has(n.id)
      const isRecent = recentNodeIds.has(n.id)
      return {
        ...n,
        style: {
          ...(n.style ?? {}),
          opacity: shouldFade ? 0.3 : 1,
          boxShadow: isRecent
            ? '0 0 0 1px rgba(34,211,238,0.8), 0 0 18px rgba(34,211,238,0.45)'
            : (n.style as { boxShadow?: string } | undefined)?.boxShadow,
          transition: 'opacity 120ms ease-out',
        },
      }
    })
  }, [highlightNodeIds, recentNodeIds, ui.selectedNodeId, visibleNodes])

  const decoratedEdges = useMemo(() => {
    const hasHighlight = ui.selectedNodeId && highlightEdgeIds.size > 0
    return visibleEdges.map((e) => {
      const shouldFade = hasHighlight && !highlightEdgeIds.has(e.id)
      const isHot = hasHighlight && highlightEdgeIds.has(e.id)
      const isRecent = recentEdgeIds.has(e.id)
      return {
        ...e,
        style: {
          ...(e.style ?? {}),
          opacity: shouldFade ? 0.2 : 0.9,
          strokeWidth: isHot || isRecent ? 2.2 : 1.2,
          stroke: isHot
            ? 'rgba(34, 211, 238, 0.95)'
            : isRecent
              ? 'rgba(34, 211, 238, 0.8)'
              : 'rgba(255,255,255,0.22)',
          filter: isHot || isRecent ? 'drop-shadow(0 0 10px rgba(34,211,238,0.35))' : undefined,
          transition: 'opacity 120ms ease-out',
        },
      }
    })
  }, [highlightEdgeIds, recentEdgeIds, ui.selectedNodeId, visibleEdges])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const scored: { id: string; label: string; score: number }[] = []
    for (const n of visibleNodes) {
      const data = n.data as unknown as { functionName?: string; contractName?: string }
      const fn = data.functionName ?? ''
      const cn = data.contractName ?? ''
      const id = n.id
      const hay = `${id} ${cn} ${fn}`.toLowerCase()
      const idx = hay.indexOf(needle)
      if (idx === -1) continue
      const score = idx + hay.length * 0.001
      scored.push({ id, label: `${cn}.${fn}()`, score })
    }
    scored.sort((a, b) => a.score - b.score)
    return scored.slice(0, 12)
  }, [query, visibleNodes])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!ui.focusNodeId) return
    const focusId = ui.focusNodeId
    let raf = 0
    const started = performance.now()

    const attempt = () => {
      const node = getNode(focusId)
      if (node) {
        const abs =
          ('positionAbsolute' in node
            ? (node as unknown as { positionAbsolute?: { x: number; y: number } }).positionAbsolute
            : undefined) ?? node.position
        const w = node.width ?? 0
        const h = node.height ?? 0
        if (w > 0 && h > 0) {
          setCenter(abs.x + w / 2, abs.y + h / 2, { duration: 420, zoom: 1.2 })
          return
        }
      }
      if (performance.now() - started > 800) return
      raf = window.requestAnimationFrame(attempt)
    }

    raf = window.requestAnimationFrame(attempt)
    return () => window.cancelAnimationFrame(raf)
  }, [getNode, setCenter, ui.focusNonce, ui.focusNodeId])

  useEffect(() => {
    if (decoratedNodes.length === 0) return
    if (ui.focusNodeId) return
    fitView({ padding: 0.18, duration: 0, minZoom: 0.02 })
  }, [decoratedNodes.length, fitView, ui.focusNodeId])

  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (decoratedNodes.length === 0) return
      const focusId = ui.focusNodeId
      if (focusId) {
        const node = getNode(focusId)
        if (!node) return
        const abs =
          ('positionAbsolute' in node
            ? (node as unknown as { positionAbsolute?: { x: number; y: number } }).positionAbsolute
            : undefined) ?? node.position
        const w = node.width ?? 0
        const h = node.height ?? 0
        if (w > 0 && h > 0) {
          setCenter(abs.x + w / 2, abs.y + h / 2, { duration: 0, zoom: 1.2 })
        }
        return
      }
      fitView({ padding: 0.18, duration: 0, minZoom: 0.02 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [decoratedNodes.length, fitView, getNode, setCenter, ui.focusNodeId])

  return (
    <div ref={containerRef} className="relative h-full w-full bg-black/15">
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={decoratedNodes}
        edges={decoratedEdges}
        onNodesChange={actions.onNodesChange}
        onEdgesChange={actions.onEdgesChange}
        onNodeClick={(_, node) => actions.setSelectedNodeId(node.id)}
        onPaneClick={() => {
          actions.setSelectedNodeId(null)
          actions.closeContextMenu()
        }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.02}
        maxZoom={2.5}
        fitView
      >
        <Background color="rgba(255,255,255,0.08)" gap={22} />
        <Controls
          position="bottom-left"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.16)' }}
        />
      </ReactFlow>
      <MovableMiniMap />
      <ContextMenu />
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/80 backdrop-blur-xl hover:bg-white/10"
            onClick={() => actions.setLeftOpen(!ui.leftOpen)}
            aria-label={ui.leftOpen ? 'Collapse left drawer' : 'Open left drawer'}
          >
            <ChevronIcon direction={ui.leftOpen ? 'left' : 'right'} />
          </button>
        </div>
        <div className="pointer-events-auto absolute right-3 top-3">
          <div className="flex items-start gap-2">
            <button
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/80 backdrop-blur-xl hover:bg-white/10"
              onClick={() => actions.setRightOpen(!ui.rightOpen)}
              aria-label={ui.rightOpen ? 'Collapse inspector' : 'Open inspector'}
            >
              <ChevronIcon direction={ui.rightOpen ? 'right' : 'left'} />
            </button>
            <div className="relative w-[320px]">
              <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-white/85 backdrop-blur-xl">
                <SearchIcon />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setOpen(true)
                  }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => window.setTimeout(() => setOpen(false), 120)}
                  placeholder="Search function / contract…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                />
              </div>
              {open && matches.length > 0 ? (
                <div className="absolute right-0 mt-2 w-full overflow-hidden rounded-xl border border-white/20 bg-black/70 backdrop-blur-xl">
                  {matches.map((m) => (
                    <button
                      key={m.id}
                      className="block w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        actions.focusNode(m.id)
                        actions.setSelectedNodeId(m.id)
                        setOpen(false)
                      }}
                    >
                      <div className="truncate">{m.label}</div>
                      <div className="truncate text-[11px] text-white/50">{m.id}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <a
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/80 backdrop-blur-xl hover:bg-white/10"
                href="https://github.com/VectorBits/OnCallGraph"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 2a10 10 0 0 0-3.16 19.48c.5.09.68-.22.68-.48v-1.7c-2.77.6-3.35-1.34-3.35-1.34-.45-1.13-1.1-1.44-1.1-1.44-.9-.62.07-.6.07-.6 1 .07 1.52 1.03 1.52 1.03.9 1.52 2.36 1.08 2.94.83.1-.64.36-1.08.65-1.33-2.22-.25-4.56-1.12-4.56-4.98 0-1.1.4-2.01 1.02-2.72-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.56 1.4.2 2.44.1 2.7.63.7 1.02 1.62 1.02 2.72 0 3.87-2.35 4.73-4.58 4.98.37.32.7.94.7 1.9v2.82c0 .27.18.58.69.48A10 10 0 0 0 12 2z"
                    fill="currentColor"
                  />
                </svg>
              </a>
              <a
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/80 backdrop-blur-xl hover:bg-white/10"
                href="https://x.com/VectorBits"
                target="_blank"
                rel="noreferrer"
                aria-label="X"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 4h3.6l4.1 5.5L16 4h4l-6.6 7.9L20 20h-3.6l-4.6-6.2L8 20H4l7.1-8.5L4 4z"
                    fill="currentColor"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  )
}
