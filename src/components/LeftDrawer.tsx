import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { parseSolidity } from '../app/parserClient'
import { createEncryptedShareHash } from '../app/persistence'
import { useAppStore } from '../app/store'
import type { SolidityVisibility } from '../app/types'
import { GlassPanel } from './GlassPanel'

const MonacoEditor = lazy(() => import('@monaco-editor/react'))

type EditorApi = {
  focus: () => void
  setSelection: (selection: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }) => void
  revealPositionInCenter: (position: { lineNumber: number; column: number }) => void
}

function labelFromNodeId(nodeId: string): string {
  const parts = nodeId.split('.')
  if (parts.length < 2) return nodeId
  const fn = parts[1].split('#')[0]
  return `${parts[0]}.${fn}()`
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (depth === 0) return i
  }
  return -1
}

function parseNodeId(nodeId: string): { contractName: string; functionName: string; occurrence: number } | null {
  const parts = nodeId.split('.')
  if (parts.length < 2) return null
  const contractName = parts[0]
  const [fn, countRaw] = parts[1].split('#')
  const occurrence = Math.max(1, Number.parseInt(countRaw ?? '1', 10) || 1)
  return { contractName, functionName: fn, occurrence }
}

function findContractRange(code: string, contractName: string): { start: number; end: number } | null {
  const re = new RegExp(`\\bcontract\\s+${escapeRegExp(contractName)}\\b`, 'g')
  const match = re.exec(code)
  if (!match) return null
  const braceIndex = code.indexOf('{', re.lastIndex)
  if (braceIndex === -1) return null
  const end = findMatchingBrace(code, braceIndex)
  if (end === -1) return null
  return { start: braceIndex + 1, end }
}

function findFunctionIndex(
  code: string,
  contractName: string,
  functionName: string,
  occurrence: number,
): { index: number; length: number } | null {
  const range = findContractRange(code, contractName)
  const body = range ? code.slice(range.start, range.end) : code
  const re = new RegExp(`\\bfunction\\s+${escapeRegExp(functionName)}\\s*\\(`, 'g')
  let match: RegExpExecArray | null = null
  let count = 0
  while ((match = re.exec(body))) {
    count += 1
    if (count !== occurrence) continue
    const nameOffset = match[0].indexOf(functionName)
    const absoluteIndex = (range ? range.start : 0) + match.index + Math.max(0, nameOffset)
    return { index: absoluteIndex, length: functionName.length }
  }
  return null
}

function indexToPosition(code: string, index: number): { lineNumber: number; column: number } {
  const before = code.slice(0, Math.max(0, index))
  const lineNumber = before.split('\n').length
  const lastBreak = before.lastIndexOf('\n')
  const column = index - lastBreak
  return { lineNumber, column }
}

export function LeftDrawer() {
  const [tab, setTab] = useState<'workspace' | 'panels' | 'notes' | 'functions'>('workspace')
  const [noteQuery, setNoteQuery] = useState('')
  const [functionsQuery, setFunctionsQuery] = useState('')
  const [visibilityFilter, setVisibilityFilter] = useState<SolidityVisibility | 'all'>('all')
  const [busy, setBusy] = useState(false)
  const [autoSync, setAutoSync] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<EditorApi | null>(null)
  const lastSyncedRef = useRef<string>('')
  const autoTimerRef = useRef<number | null>(null)

  const { panels, activePanelId, actions, selectedNodeId, sharePermission, lastSyncStats } = useAppStore(
    useShallow((s) => ({
      panels: s.panels,
      activePanelId: s.activePanelId,
      actions: s.actions,
      selectedNodeId: s.ui.selectedNodeId,
      sharePermission: s.ui.sharePermission,
      lastSyncStats: s.lastSyncStats,
    })),
  )

  const canMutate = sharePermission === 'normal'
  const activePanel = panels.find((p) => p.id === activePanelId) ?? panels[0]

  const notesResults = useMemo(() => {
    const needle = noteQuery.trim().toLowerCase()
    const items: { panelId: string; panelName: string; nodeId: string; content: string; updatedAt: number }[] = []
    for (const p of panels) {
      for (const note of Object.values(p.notesByNodeId)) {
        if (!note.content?.trim()) continue
        const hay = `${note.nodeId}\n${note.content}`.toLowerCase()
        if (needle && !hay.includes(needle)) continue
        items.push({
          panelId: p.id,
          panelName: p.name,
          nodeId: note.nodeId,
          content: note.content,
          updatedAt: note.updatedAt,
        })
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt)
    return items.slice(0, needle ? 80 : 24)
  }, [noteQuery, panels])

  const visibleFunctions = useMemo(() => {
    const blacklisted = new Set(activePanel.blacklistedNodeIds)
    const trashed = new Set(activePanel.trashedNodeIds)
    const seen = new Set<string>()
    return activePanel.nodes.filter((n) => {
      if (blacklisted.has(n.id) || trashed.has(n.id)) return false
      if (seen.has(n.id)) return false
      seen.add(n.id)
      return true
    })
  }, [activePanel.blacklistedNodeIds, activePanel.nodes, activePanel.trashedNodeIds])

  const visibilityCounts = useMemo(() => {
    const counts: Record<string, number> = { public: 0, external: 0, internal: 0, private: 0, unknown: 0 }
    for (const n of visibleFunctions) counts[(n.data as { visibility?: string }).visibility ?? 'unknown'] = (counts[(n.data as { visibility?: string }).visibility ?? 'unknown'] ?? 0) + 1
    return counts as Record<SolidityVisibility, number>
  }, [visibleFunctions])

  const filteredFunctions = useMemo(() => {
    const needle = functionsQuery.trim().toLowerCase()
    const items = visibleFunctions.filter((n) => {
      const v = (n.data as { visibility?: SolidityVisibility }).visibility ?? 'unknown'
      if (visibilityFilter !== 'all' && v !== visibilityFilter) return false
      if (!needle) return true
      const d = n.data as { contractName?: string; functionName?: string }
      const hay = `${n.id} ${d.contractName ?? ''} ${d.functionName ?? ''}`.toLowerCase()
      return hay.includes(needle)
    })
    items.sort((a, b) => {
      const ad = a.data as { contractName?: string; functionName?: string }
      const bd = b.data as { contractName?: string; functionName?: string }
      const ac = (ad.contractName ?? '').localeCompare(bd.contractName ?? '')
      if (ac !== 0) return ac
      return (ad.functionName ?? '').localeCompare(bd.functionName ?? '')
    })
    return items
  }, [functionsQuery, visibilityFilter, visibleFunctions])

  useEffect(() => {
    const state = useAppStore.getState()
    const panel = state.panels.find((p) => p.id === activePanelId) ?? state.panels[0]
    if (panel) lastSyncedRef.current = panel.code
  }, [activePanelId])

  useEffect(() => {
    if (!autoSync || !canMutate) return
    if (busy) return
    if (activePanel.code === lastSyncedRef.current) return
    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current)
    autoTimerRef.current = window.setTimeout(async () => {
      setError(null)
      setBusy(true)
      try {
        const result = await parseSolidity(activePanel.code)
        actions.syncFromParseResult(result)
        lastSyncedRef.current = activePanel.code
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Parse failed')
      } finally {
        setBusy(false)
      }
    }, 900)
    return () => {
      if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current)
    }
  }, [actions, activePanel.code, autoSync, busy, canMutate])

  useEffect(() => {
    const onJump = (ev: Event) => {
      const detail = (ev as CustomEvent<{ nodeId?: string }>).detail
      const nodeId = detail?.nodeId
      if (!nodeId) return
      const parsed = parseNodeId(nodeId)
      if (!parsed) return
      const found = findFunctionIndex(activePanel.code, parsed.contractName, parsed.functionName, parsed.occurrence)
      if (!found) return
      setTab('workspace')
      const start = indexToPosition(activePanel.code, found.index)
      const end = indexToPosition(activePanel.code, found.index + found.length)
      const started = performance.now()
      const attempt = () => {
        const editor = editorRef.current
        if (editor) {
          editor.focus()
          editor.setSelection({
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          })
          editor.revealPositionInCenter({ lineNumber: start.lineNumber, column: start.column })
          return
        }
        if (performance.now() - started > 900) return
        window.requestAnimationFrame(attempt)
      }
      window.requestAnimationFrame(attempt)
    }
    window.addEventListener('cp:jumpToCode', onJump)
    return () => window.removeEventListener('cp:jumpToCode', onJump)
  }, [activePanel.code])

  return (
    <GlassPanel className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/12 bg-black/20 px-3 py-2 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">Vectorbits-tools-CallGraph</div>
          <div className="truncate text-xs text-white/60">{sharePermission === 'read' ? 'Read-only' : 'Editable'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={[
              'rounded-lg border px-3 py-1.5 text-xs transition-colors',
              tab === 'workspace'
                ? 'border-white/25 bg-white/10 text-white/90'
                : 'border-white/12 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10',
            ].join(' ')}
            onClick={() => setTab('workspace')}
          >
            Workspace
          </button>
          <button
            className={[
              'rounded-lg border px-3 py-1.5 text-xs transition-colors',
              tab === 'panels'
                ? 'border-white/25 bg-white/10 text-white/90'
                : 'border-white/12 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10',
            ].join(' ')}
            onClick={() => setTab('panels')}
          >
            Panels
          </button>
          <button
            className={[
              'rounded-lg border px-3 py-1.5 text-xs transition-colors',
              tab === 'notes'
                ? 'border-white/25 bg-white/10 text-white/90'
                : 'border-white/12 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10',
            ].join(' ')}
            onClick={() => setTab('notes')}
          >
            Notes
          </button>
          <button
            className={[
              'rounded-lg border px-3 py-1.5 text-xs transition-colors',
              tab === 'functions'
                ? 'border-white/25 bg-white/10 text-white/90'
                : 'border-white/12 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10',
            ].join(' ')}
            onClick={() => setTab('functions')}
          >
            Functions
          </button>
        </div>
      </div>

      {error ? <div className="border-b border-white/12 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

      {tab === 'workspace' ? (
        <>
          <div className="flex items-center gap-2 border-b border-white/12 px-3 py-2">
            <input
              value={activePanel.name}
              onChange={(e) => actions.renamePanel(activePanel.id, e.target.value)}
              disabled={!canMutate}
              className="min-w-0 flex-1 truncate rounded-lg border border-white/12 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/25"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-white/12 px-3 py-2">
            <button
              disabled={!canMutate}
              className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/75 transition-colors hover:border-white/20 hover:bg-white/10"
              onClick={async () => {
                const url = new URL(window.location.href)
                url.hash = await createEncryptedShareHash(activePanel, 'read')
                await navigator.clipboard?.writeText(url.toString())
              }}
            >
              Copy Read Link
            </button>
            <button
              disabled={!canMutate}
              className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs text-white/75 transition-colors hover:border-white/20 hover:bg-white/10"
              onClick={async () => {
                const url = new URL(window.location.href)
                url.hash = await createEncryptedShareHash(activePanel, 'edit')
                await navigator.clipboard?.writeText(url.toString())
              }}
            >
              Copy Edit Link
            </button>
            <div className="flex-1" />
            <button
              disabled={!canMutate}
              className={[
                'rounded-lg border px-3 py-2 text-xs transition-colors',
                autoSync
                  ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
                  : 'border-white/12 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10',
              ].join(' ')}
              onClick={() => setAutoSync(!autoSync)}
            >
              Auto Sync: {autoSync ? 'On' : 'Off'}
            </button>
            <button
              disabled={busy || !canMutate}
              className={[
                'rounded-lg border px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_30px_rgba(88,101,242,0.25)] transition',
                busy || !canMutate
                  ? 'cursor-not-allowed border-white/10 bg-white/5 text-white/50'
                  : 'border-white/15 bg-gradient-to-r from-indigo-500/90 to-cyan-400/80 hover:from-indigo-500 hover:to-cyan-400',
              ].join(' ')}
              onClick={async () => {
                setError(null)
                setBusy(true)
                try {
                  const result = await parseSolidity(activePanel.code)
                  actions.syncFromParseResult(result)
                  lastSyncedRef.current = activePanel.code
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Parse failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {!canMutate ? 'Read-only' : busy ? 'Syncing…' : 'Sync to Graph'}
            </button>
          </div>
          {lastSyncStats ? (
            <div className="border-b border-white/10 px-3 py-2 text-xs text-white/55">
              +{lastSyncStats.addedNodes} nodes · +{lastSyncStats.addedEdges} edges · -{lastSyncStats.removedNodes} nodes · -{lastSyncStats.removedEdges} edges
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="h-full w-full bg-black/20" />}>
              <MonacoEditor
                height="100%"
                defaultLanguage="sol"
                value={activePanel.code}
                onChange={(value: string | undefined) => actions.setCode(value ?? '')}
                onMount={(editor: unknown) => {
                  editorRef.current = editor as EditorApi
                }}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'gutter',
                  tabSize: 2,
                  padding: { top: 16, bottom: 16 },
                  readOnly: !canMutate,
                }}
                theme="vs-dark"
              />
            </Suspense>
          </div>
        </>
      ) : tab === 'panels' ? (
        <>
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <div className="text-xs font-semibold text-white/70">Panels</div>
            <div className="flex-1" />
            <button
              disabled={!canMutate}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
              onClick={() => actions.createPanel()}
            >
              New
            </button>
          </div>

          <div className="px-3 py-2">
            <div className="grid gap-1">
              {panels.map((p) => (
                <div
                  key={p.id}
                  className={[
                    'group flex items-center gap-2 rounded-lg border px-2 py-1.5',
                    p.id === activePanelId
                      ? 'border-white/20 bg-white/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10',
                  ].join(' ')}
                >
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    onClick={() => actions.setActivePanelId(p.id)}
                  >
                    {p.name}
                  </button>
                  <button
                    disabled={!canMutate}
                    className="hidden rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 group-hover:block disabled:cursor-not-allowed"
                    onClick={() => actions.duplicatePanel(p.id)}
                  >
                    Copy
                  </button>
                  <button
                    disabled={!canMutate}
                    className="hidden rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 group-hover:block disabled:cursor-not-allowed"
                    onClick={() => actions.deletePanel(p.id)}
                  >
                    Del
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            <div className="mt-5 grid gap-4">
              <div>
                <div className="text-xs font-semibold text-white/70">Blacklist</div>
                <div className="mt-2 grid gap-1">
                  {activePanel.blacklistedNodeIds.length === 0 ? (
                    <div className="text-xs text-white/45">Right-click a node to blacklist it.</div>
                  ) : (
                    activePanel.blacklistedNodeIds.map((id) => (
                      <div
                        key={id}
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5"
                      >
                        <button
                          className="min-w-0 flex-1 truncate text-left text-xs text-white/70"
                          onClick={() => actions.focusNode(id)}
                        >
                          {labelFromNodeId(id)}
                        </button>
                        <button
                          disabled={!canMutate}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
                          onClick={() => actions.toggleBlacklist(id)}
                        >
                          Unhide
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-white/70">Trash</div>
                <div className="mt-2 grid gap-1">
                  {activePanel.trashedNodeIds.length === 0 ? (
                    <div className="text-xs text-white/45">Deleted nodes show up here for restore.</div>
                  ) : (
                    activePanel.trashedNodeIds.map((id) => (
                      <div
                        key={id}
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1 truncate text-xs text-white/60">{labelFromNodeId(id)}</div>
                        <button
                          disabled={!canMutate}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
                          onClick={() => actions.restoreNode(id)}
                        >
                          Restore
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : tab === 'notes' ? (
        <>
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <button
              disabled={!canMutate || !selectedNodeId}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
              onClick={() => selectedNodeId && actions.openNoteEditor(selectedNodeId)}
            >
              New Note
            </button>
            <div className="flex-1" />
            <input
              value={noteQuery}
              onChange={(e) => setNoteQuery(e.target.value)}
              placeholder="Search notes…"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/20"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            <div className="grid gap-2">
              {notesResults.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-white/50">
                  No notes yet. Right-click a node to add a note.
                </div>
              ) : (
                notesResults.map((n) => (
                  <div
                    key={`${n.panelId}:${n.nodeId}`}
                    className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10"
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        actions.setActivePanelId(n.panelId)
                        actions.focusNode(n.nodeId)
                        actions.setSelectedNodeId(n.nodeId)
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="truncate text-xs font-semibold text-white/80">{n.panelName}</div>
                        <div className="truncate text-xs text-white/60">{labelFromNodeId(n.nodeId)}</div>
                      </div>
                      <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-white/60">{n.content}</div>
                    </button>
                    <button
                      disabled={!canMutate}
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/45"
                      onClick={() => actions.deleteNoteInPanel(n.panelId, n.nodeId)}
                      aria-label="Delete note"
                    >
                      Del
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <input
              value={functionsQuery}
              onChange={(e) => setFunctionsQuery(e.target.value)}
              placeholder="Search functions…"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/20"
            />
          </div>

          <div className="border-b border-white/10 px-3 py-2">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { key: 'all', label: 'All', count: visibleFunctions.length },
                  { key: 'public', label: 'Public', count: visibilityCounts.public ?? 0 },
                  { key: 'external', label: 'External', count: visibilityCounts.external ?? 0 },
                  { key: 'internal', label: 'Internal', count: visibilityCounts.internal ?? 0 },
                  { key: 'private', label: 'Private', count: visibilityCounts.private ?? 0 },
                  { key: 'unknown', label: 'Unknown', count: visibilityCounts.unknown ?? 0 },
                ] as { key: SolidityVisibility | 'all'; label: string; count: number }[]
              ).map((f) => (
                <button
                  key={f.key}
                  className={[
                    'rounded-full border px-3 py-1 text-xs',
                    visibilityFilter === f.key ? 'border-white/20 bg-white/10 text-white/90' : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                  ].join(' ')}
                  onClick={() => setVisibilityFilter(f.key)}
                >
                  {f.label} {f.count}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {filteredFunctions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-white/50">
                No functions found.
              </div>
            ) : (
              <div className="grid gap-1">
                {filteredFunctions.map((n) => {
                  const data = n.data as { contractName: string; functionName: string; visibility: SolidityVisibility; hasNote?: boolean }
                  const hasNote = Boolean(activePanel.notesByNodeId[n.id]?.content?.trim())
                  return (
                    <button
                      key={n.id}
                      className={[
                        'flex items-center gap-2 rounded-lg border px-2 py-2 text-left',
                        n.id === selectedNodeId ? 'border-white/20 bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10',
                      ].join(' ')}
                      onClick={() => {
                        actions.focusNode(n.id)
                        actions.setSelectedNodeId(n.id)
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-white/85">{labelFromNodeId(n.id)}</div>
                        <div className="truncate text-[11px] text-white/50">{data.contractName}</div>
                      </div>
                      {hasNote ? (
                        <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                          Note
                        </div>
                      ) : null}
                      <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                        {data.visibility}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </GlassPanel>
  )
}
