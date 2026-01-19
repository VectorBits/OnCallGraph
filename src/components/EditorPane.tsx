import { useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useAppStore } from '../app/store'
import { GlassPanel } from './GlassPanel'

function labelFromNodeId(nodeId: string): string {
  const parts = nodeId.split('.')
  if (parts.length < 2) return nodeId
  const fn = parts[1].split('#')[0]
  return `${parts[0]}.${fn}()`
}

export function EditorPane() {
  const { panel, selectedNodeId, sharePermission, actions } = useAppStore(
    useShallow((s) => {
      const panel = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
      return {
        panel,
        selectedNodeId: s.ui.selectedNodeId,
        sharePermission: s.ui.sharePermission,
        actions: s.actions,
      }
    }),
  )

  const isReadOnly = sharePermission === 'read'

  const node = useMemo(() => {
    if (!selectedNodeId) return null
    return panel.nodes.find((n) => n.id === selectedNodeId) ?? null
  }, [panel.nodes, selectedNodeId])

  const note = useMemo(() => {
    if (!selectedNodeId) return null
    const text = panel.notesByNodeId[selectedNodeId]?.content?.trim()
    return text ? text : null
  }, [panel.notesByNodeId, selectedNodeId])

  const stats = useMemo(() => {
    if (!selectedNodeId) return { inCount: 0, outCount: 0 }
    let inCount = 0
    let outCount = 0
    for (const e of panel.edges) {
      if (e.source === selectedNodeId) outCount++
      if (e.target === selectedNodeId) inCount++
    }
    return { inCount, outCount }
  }, [panel.edges, selectedNodeId])

  const incoming = useMemo(() => {
    if (!selectedNodeId) return []
    const ids = panel.edges.filter((e) => e.target === selectedNodeId).map((e) => e.source)
    return Array.from(new Set(ids))
  }, [panel.edges, selectedNodeId])

  const outgoing = useMemo(() => {
    if (!selectedNodeId) return []
    const ids = panel.edges.filter((e) => e.source === selectedNodeId).map((e) => e.target)
    return Array.from(new Set(ids))
  }, [panel.edges, selectedNodeId])

  if (!selectedNodeId || !node) {
    return (
      <GlassPanel className="flex flex-col">
        <div className="border-b border-white/12 bg-black/20 px-3 py-2 text-sm font-semibold text-white/85">Inspector</div>
        <div className="flex-1 px-3 py-3 text-sm text-white/55">Select a node to inspect details.</div>
      </GlassPanel>
    )
  }

  const isBlacklisted = panel.blacklistedNodeIds.includes(selectedNodeId)
  const title = labelFromNodeId(selectedNodeId)

  return (
    <GlassPanel className="flex flex-col">
      <div className="border-b border-white/12 bg-black/20 px-3 py-2">
        <div className="truncate text-sm font-semibold text-white/90">{title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-white/55">
          <div className="truncate">{node.data.visibility}</div>
          <div>•</div>
          <div>in {stats.inCount}</div>
          <div>•</div>
          <div>out {stats.outCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-white/12 px-3 py-2">
        <button
          disabled={isReadOnly}
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/75 transition-colors hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
          onClick={() => actions.openNoteEditor(selectedNodeId)}
        >
          {note ? 'Edit Note' : 'Add Note'}
        </button>
        <button
          disabled={isReadOnly}
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/75 transition-colors hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
          onClick={() => actions.toggleBlacklist(selectedNodeId)}
        >
          {isBlacklisted ? 'Unblacklist' : 'Blacklist'}
        </button>
        <button
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/75 transition-colors hover:border-white/20 hover:bg-white/10"
          onClick={async () => {
            await navigator.clipboard?.writeText(selectedNodeId)
          }}
        >
          Copy ID
        </button>
        <button
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/75 transition-colors hover:border-white/20 hover:bg-white/10"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('cp:jumpToCode', { detail: { nodeId: selectedNodeId } }))
          }}
        >
          Locate in Code
        </button>
        <div className="flex-1" />
        <button
          disabled={isReadOnly}
          className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs text-rose-200 transition-colors hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-rose-200/40"
          onClick={() => actions.trashNode(selectedNodeId)}
        >
          Delete
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <div className="grid gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs font-semibold text-white/75">Incoming</div>
            {incoming.length === 0 ? (
              <div className="mt-2 text-xs text-white/50">No callers.</div>
            ) : (
              <div className="mt-2 grid gap-1">
                {incoming.map((id) => (
                  <button
                    key={id}
                    className="truncate rounded-md border border-white/10 bg-white/5 px-2 py-1 text-left text-xs text-white/70 hover:bg-white/10"
                    onClick={() => {
                      actions.focusNode(id)
                      actions.setSelectedNodeId(id)
                    }}
                  >
                    {labelFromNodeId(id)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs font-semibold text-white/75">Outgoing</div>
            {outgoing.length === 0 ? (
              <div className="mt-2 text-xs text-white/50">No callees.</div>
            ) : (
              <div className="mt-2 grid gap-1">
                {outgoing.map((id) => (
                  <button
                    key={id}
                    className="truncate rounded-md border border-white/10 bg-white/5 px-2 py-1 text-left text-xs text-white/70 hover:bg-white/10"
                    onClick={() => {
                      actions.focusNode(id)
                      actions.setSelectedNodeId(id)
                    }}
                  >
                    {labelFromNodeId(id)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3">
        {note ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-white/75">Note</div>
              <button
                disabled={isReadOnly}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
                onClick={() => actions.deleteNote(selectedNodeId)}
              >
                Delete Note
              </button>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{note}</div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-3 text-sm text-white/55">
            No note yet.
          </div>
        )}
        </div>
      </div>
    </GlassPanel>
  )
}
