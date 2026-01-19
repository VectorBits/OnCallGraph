import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { useAppStore } from '../app/store'

function labelFromNodeId(nodeId: string): string {
  const parts = nodeId.split('.')
  if (parts.length < 2) return nodeId
  const fn = parts[1].split('#')[0]
  return `${parts[0]}.${fn}()`
}

export function ContextMenu() {
  const { contextMenu, activePanel, actions } = useAppStore(
    useShallow((s) => {
      const panel = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
      return { contextMenu: s.ui.contextMenu, activePanel: panel, actions: s.actions }
    }),
  )
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.closeContextMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions, contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const maxX = window.innerWidth - rect.width - margin
    const maxY = window.innerHeight - rect.height - margin
    const nextX = Math.max(margin, Math.min(contextMenu.x, maxX))
    const nextY = Math.max(margin, Math.min(contextMenu.y, maxY))
    el.style.left = `${nextX}px`
    el.style.top = `${nextY}px`
  }, [contextMenu])

  if (!contextMenu) return null

  const nodeId = contextMenu.nodeId
  const hasNote = Boolean(activePanel.notesByNodeId[nodeId]?.content?.trim())
  const isBlacklisted = activePanel.blacklistedNodeIds.includes(nodeId)
  const jumpToCode = () => window.dispatchEvent(new CustomEvent('cp:jumpToCode', { detail: { nodeId } }))

  return (
    <div
      className="fixed inset-0 z-40"
      onMouseDown={() => actions.closeContextMenu()}
      onContextMenu={(e) => {
        e.preventDefault()
        actions.closeContextMenu()
      }}
    >
      <div
        ref={menuRef}
        className="absolute z-50 w-[240px] overflow-hidden rounded-xl border border-white/20 bg-black/70 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/12 bg-white/5 px-3 py-2 text-xs font-semibold text-white/85">
          {labelFromNodeId(nodeId)}
        </div>
        <div className="grid">
          <button
            className="px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            onClick={() => {
              actions.closeContextMenu()
              actions.openNoteEditor(nodeId)
            }}
          >
            {hasNote ? 'Edit Note' : 'Add Note'}
          </button>
          <button
            className="px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            onClick={() => {
              actions.closeContextMenu()
              jumpToCode()
            }}
          >
            Locate in Code
          </button>
          <button
            className="px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            onClick={() => {
              actions.closeContextMenu()
              actions.toggleBlacklist(nodeId)
            }}
          >
            {isBlacklisted ? 'Remove from Blacklist' : 'Add to Blacklist'}
          </button>
          <button
            className="px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
            onClick={async () => {
              await navigator.clipboard?.writeText(nodeId)
              actions.closeContextMenu()
            }}
          >
            Copy Node ID
          </button>
          <button
            className="px-3 py-2 text-left text-sm text-rose-200 hover:bg-white/10"
            onClick={() => actions.trashNode(nodeId)}
          >
            Delete (to Trash)
          </button>
        </div>
      </div>
    </div>
  )
}
