import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useShallow } from 'zustand/shallow'
import { useAppStore } from '../app/store'

function labelFromNodeId(nodeId: string): string {
  const parts = nodeId.split('.')
  if (parts.length < 2) return nodeId
  const fn = parts[1].split('#')[0]
  return `${parts[0]}.${fn}()`
}

export function NoteModal({ nodeId }: { nodeId: string }) {
  const { activePanel, actions } = useAppStore(
    useShallow((s) => {
      const panel = s.panels.find((p) => p.id === s.activePanelId) ?? s.panels[0]
      return { activePanel: panel, actions: s.actions }
    }),
  )

  const initial = activePanel.notesByNodeId[nodeId]?.content ?? ''
  const [value, setValue] = useState(initial)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')

  useEffect(() => {
    setValue(initial)
  }, [initial])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.closeNoteEditor()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') {
        actions.upsertNote({ nodeId, content: value, updatedAt: Date.now() })
        actions.closeNoteEditor()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions, nodeId, value])

  const title = useMemo(() => labelFromNodeId(nodeId), [nodeId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={() => actions.closeNoteEditor()}
    >
      <div
        className="w-full max-w-[980px] overflow-hidden rounded-2xl border border-white/20 bg-black/70 shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/12 bg-white/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white/90">{title}</div>
            <div className="truncate text-xs text-white/60">Markdown note • ⌘/Ctrl + Enter to save</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={[
                'rounded-lg border px-3 py-1.5 text-xs',
                tab === 'edit' ? 'border-white/20 bg-white/10 text-white/90' : 'border-white/10 bg-white/5 text-white/70',
              ].join(' ')}
              onClick={() => setTab('edit')}
            >
              Edit
            </button>
            <button
              className={[
                'rounded-lg border px-3 py-1.5 text-xs',
                tab === 'preview'
                  ? 'border-white/20 bg-white/10 text-white/90'
                  : 'border-white/10 bg-white/5 text-white/70',
              ].join(' ')}
              onClick={() => setTab('preview')}
            >
              Preview
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
          <div className="border-r border-white/10">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Write your audit note…"
              className="h-[520px] w-full resize-none bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-white/35"
            />
          </div>
          <div className="h-[520px] overflow-auto p-4">
            {tab === 'preview' ? (
              <div className="text-sm leading-relaxed text-white/80">
                <ReactMarkdown
                  components={{
                    h1: (p) => <h1 className="mb-3 text-xl font-semibold tracking-tight text-white/90" {...p} />,
                    h2: (p) => <h2 className="mb-2 text-lg font-semibold tracking-tight text-white/90" {...p} />,
                    h3: (p) => <h3 className="mb-2 text-base font-semibold tracking-tight text-white/90" {...p} />,
                    p: (p) => <p className="mb-2 text-white/80" {...p} />,
                    a: (p) => <a className="text-cyan-300 underline underline-offset-2" {...p} />,
                    code: (p) => (
                      <code className="rounded-md border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[12px]" {...p} />
                    ),
                    pre: (p) => (
                      <pre
                        className="mb-2 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[12px] leading-relaxed text-white/85"
                        {...p}
                      />
                    ),
                    ul: (p) => <ul className="mb-2 list-disc pl-5 text-white/80" {...p} />,
                    ol: (p) => <ol className="mb-2 list-decimal pl-5 text-white/80" {...p} />,
                    li: (p) => <li className="mb-1" {...p} />,
                    blockquote: (p) => (
                      <blockquote className="mb-2 border-l-2 border-white/15 pl-3 text-white/70" {...p} />
                    ),
                  }}
                >
                  {value || '_Nothing to preview_'}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-sm text-white/60">
                Switch to Preview to render Markdown.
                <div className="mt-2 text-xs text-white/45">
                  Tip: Use headings, checklists, and code blocks to keep audits structured.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <button
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
            onClick={() => {
              actions.deleteNote(nodeId)
              actions.closeNoteEditor()
            }}
          >
            Delete Note
          </button>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
              onClick={() => actions.closeNoteEditor()}
            >
              Cancel
            </button>
            <button
              className="rounded-lg border border-white/15 bg-gradient-to-r from-indigo-500/90 to-cyan-400/80 px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_30px_rgba(88,101,242,0.25)] hover:from-indigo-500 hover:to-cyan-400"
              onClick={() => {
                actions.upsertNote({ nodeId, content: value, updatedAt: Date.now() })
                actions.closeNoteEditor()
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
