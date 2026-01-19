import { useEffect, useMemo } from 'react'
import { applyPersisted, importEncryptedShareHash, startAutosave } from './persistence'
import { useAppStore } from './store'
import { GraphCanvas } from '../components/GraphCanvas'
import { LeftDrawer } from '../components/LeftDrawer'
import { NoteModal } from '../components/NoteModal'
import { EditorPane } from '../components/EditorPane'


export function AppShell() {
  const leftOpen = useAppStore((s) => s.ui.leftOpen)
  const rightOpen = useAppStore((s) => s.ui.rightOpen)
  const noteEditor = useAppStore((s) => s.ui.noteEditor)

  const gridTemplateColumns = useMemo(() => {
    const left = leftOpen ? '520px' : '0px'
    const right = rightOpen ? '360px' : '0px'
    return `${left} 1fr ${right}`
  }, [leftOpen, rightOpen])

  useEffect(() => {
    applyPersisted()
    ;(async () => {
      const shared = await importEncryptedShareHash(window.location.hash)
      if (!shared) return
      const next = { ...shared.panel, id: crypto.randomUUID(), name: `${shared.panel.name} Shared` }
      const state = useAppStore.getState()
      state.actions.hydratePanels([next], next.id)
      state.actions.setSharePermission(shared.permission === 'read' ? 'read' : 'normal')
      state.actions.setLeftOpen(true)
      state.actions.setRightOpen(false)
    })()
    const stop = startAutosave()
    return () => stop()
  }, [])

  return (
    <div
      className="grid h-full w-full overflow-hidden bg-white/5 p-px"
      style={{ gridTemplateColumns, gap: '1px' }}
    >
      <div className={leftOpen ? 'min-h-0 min-w-0' : 'w-0 overflow-hidden'}>
        <LeftDrawer />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <GraphCanvas />
      </div>
      <div className={rightOpen ? 'min-h-0 min-w-0' : 'w-0 overflow-hidden'}>
        <EditorPane />
      </div>
      {noteEditor ? <NoteModal nodeId={noteEditor.nodeId} /> : null}
    </div>
  )
}
