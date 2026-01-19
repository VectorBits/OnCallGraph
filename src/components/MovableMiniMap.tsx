import { useEffect, useRef, useState } from 'react'
import { MiniMap } from 'reactflow'
import { useShallow } from 'zustand/shallow'
import { useAppStore } from '../app/store'
import type { FunctionNodeData } from '../app/types'

function nodeColor(data: FunctionNodeData): string {
  if (data.visibility === 'public') return 'rgba(88, 101, 242, 0.95)'
  if (data.visibility === 'external') return 'rgba(34, 211, 238, 0.95)'
  if (data.visibility === 'internal') return 'rgba(34, 197, 94, 0.95)'
  if (data.visibility === 'private') return 'rgba(244, 63, 94, 0.95)'
  return 'rgba(148, 163, 184, 0.9)'
}

export function MovableMiniMap() {
  const { minimap, actions } = useAppStore(
    useShallow((s) => {
      const panel = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
      return { minimap: panel.minimap, actions: s.actions }
    }),
  )
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const start = startRef.current
      if (!start) return
      const nextX = Math.max(8, start.ox + (e.clientX - start.x))
      const nextY = Math.max(8, start.oy + (e.clientY - start.y))
      actions.setMinimapPosition(nextX, nextY)
    }
    const onUp = () => {
      setDragging(false)
      startRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [actions, dragging])

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="pointer-events-auto absolute w-[240px] overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-[0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        style={{ right: minimap.x, bottom: minimap.y }}
      >
        <div
          className="cursor-grab border-b border-white/12 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 active:cursor-grabbing"
          onPointerDown={(e) => {
            setDragging(true)
            startRef.current = { x: e.clientX, y: e.clientY, ox: minimap.x, oy: minimap.y }
          }}
        >
          Radar
        </div>
        <div className="h-[160px] bg-black/30">
          <MiniMap
            nodeColor={(n) => nodeColor(n.data as FunctionNodeData)}
            maskColor="rgba(0,0,0,0.25)"
            pannable
            zoomable
          />
        </div>
      </div>
    </div>
  )
}
