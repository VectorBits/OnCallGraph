import type { Edge, Node } from 'reactflow'

export type SolidityVisibility = 'public' | 'private' | 'internal' | 'external' | 'unknown'

export type FunctionNodeData = {
  label: string
  contractName: string
  functionName: string
  visibility: SolidityVisibility
  isBlacklisted: boolean
  hasNote: boolean
}

export type FunctionNode = Node<FunctionNodeData>

export type CallEdge = Edge

export type Note = {
  nodeId: string
  content: string
  updatedAt: number
}

export type Panel = {
  id: string
  name: string
  code: string
  nodes: FunctionNode[]
  edges: CallEdge[]
  notesByNodeId: Record<string, Note>
  blacklistedNodeIds: string[]
  trashedNodeIds: string[]
  minimap: { x: number; y: number }
}

export type ParseFunction = {
  id: string
  contractName: string
  functionName: string
  visibility: SolidityVisibility
}

export type ParseEdge = {
  source: string
  target: string
}

export type ParseResult = {
  functions: ParseFunction[]
  edges: ParseEdge[]
}

export type UiState = {
  leftOpen: boolean
  rightOpen: boolean
  sharePermission: 'normal' | 'read'
  contextMenu:
    | {
        nodeId: string
        x: number
        y: number
      }
    | null
  noteEditor:
    | {
        nodeId: string
      }
    | null
  selectedNodeId: string | null
  focusNodeId: string | null
  focusNonce: number
}

export type PersistedStateV1 = {
  version: 1
  activePanelId: string
  panels: Panel[]
}
