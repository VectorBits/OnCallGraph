import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { FunctionNodeData } from '../app/types'
import { useAppStore } from '../app/store'

function visibilityColor(visibility: FunctionNodeData['visibility']): string {
  if (visibility === 'public') return 'rgba(88, 101, 242, 1)'
  if (visibility === 'external') return 'rgba(34, 211, 238, 1)'
  if (visibility === 'internal') return 'rgba(34, 197, 94, 1)'
  if (visibility === 'private') return 'rgba(244, 63, 94, 1)'
  return 'rgba(148, 163, 184, 1)'
}

export const FunctionNode = memo(function FunctionNode(props: NodeProps<FunctionNodeData>) {
  const { id, data, selected } = props
  const openContextMenu = useAppStore((s) => s.actions.openContextMenu)
  const setSelectedNodeId = useAppStore((s) => s.actions.setSelectedNodeId)

  const color = visibilityColor(data.visibility)

  return (
    <div
      onClick={(e) => {
        setSelectedNodeId(id)
        if (e.ctrlKey || e.metaKey) {
          window.dispatchEvent(new CustomEvent('cp:jumpToCode', { detail: { nodeId: id } }))
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setSelectedNodeId(id)
        openContextMenu(id, e.clientX, e.clientY)
      }}
      className={[
        'min-w-[180px] max-w-[260px] rounded-2xl border bg-white/5 px-3 py-2 shadow-sm transition',
        selected ? 'border-white/25 bg-white/[0.12]' : 'border-white/12 hover:border-white/25 hover:bg-white/[0.08]',
      ].join(' ')}
      style={{
        boxShadow: selected ? `0 0 0 1px rgba(255,255,255,0.2), 0 14px 40px rgba(0,0,0,0.45)` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 8,
          height: 8,
          background: 'rgba(255,255,255,0.18)',
          border: '1px solid rgba(255,255,255,0.22)',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 8,
          height: 8,
          background: 'rgba(255,255,255,0.18)',
          border: '1px solid rgba(255,255,255,0.22)',
        }}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{data.functionName}</div>
          <div className="truncate text-[11px] text-white/55">{data.contractName}</div>
        </div>
        <div className="flex items-center gap-1">
          {data.hasNote ? (
            <div className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/70">
              Note
            </div>
          ) : null}
          <div
            className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px]"
            style={{ color, borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
          >
            {data.visibility}
          </div>
        </div>
      </div>
    </div>
  )
})
