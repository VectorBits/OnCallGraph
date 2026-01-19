import { getActivePanel, useAppStore } from './store'
import type { PersistedStateV1, Panel } from './types'

const STORAGE_PREFIX = 'vectorbits-tools:v1'

function storageKey(): string {
  return `${STORAGE_PREFIX}:local`
}

function safeParse(json: string | null): PersistedStateV1 | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as PersistedStateV1
    if (!parsed || parsed.version !== 1) return null
    if (!Array.isArray(parsed.panels) || parsed.panels.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function normalizePanels(panels: Panel[]): Panel[] {
  return panels.map((p) => ({
    ...p,
    notesByNodeId: p.notesByNodeId ?? {},
    blacklistedNodeIds: p.blacklistedNodeIds ?? [],
    trashedNodeIds: p.trashedNodeIds ?? [],
    minimap: p.minimap ?? { x: 16, y: 16 },
  }))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function loadPersisted(): PersistedStateV1 | null {
  return safeParse(localStorage.getItem(storageKey()))
}

export function applyPersisted(): void {
  const persisted = loadPersisted()
  if (!persisted) return
  const panels = normalizePanels(persisted.panels)
  const activePanelId = panels.some((p) => p.id === persisted.activePanelId) ? persisted.activePanelId : panels[0].id
  useAppStore.getState().actions.hydratePanels(panels, activePanelId)
}

export function startAutosave(): () => void {
  let timer: number | null = null
  let lastSerialized = ''

  const unsub = useAppStore.subscribe((state) => {
    const persisted: PersistedStateV1 = {
      version: 1,
      activePanelId: state.activePanelId,
      panels: state.panels,
    }
    const serialized = JSON.stringify(persisted)
    if (serialized === lastSerialized) return
    lastSerialized = serialized
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey(), serialized)
      } catch {
        return
      }
    }, 450)
  })

  return () => {
    if (timer) window.clearTimeout(timer)
    unsub()
  }
}

export function exportActivePanelSnapshot(): string {
  const state = useAppStore.getState()
  const panel = getActivePanel(state)
  const data = new TextEncoder().encode(JSON.stringify(panel))
  return bytesToBase64Url(data)
}

export function importPanelSnapshot(snapshot: string): Panel | null {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(snapshot))
    const parsed = JSON.parse(json) as Panel
    if (!parsed?.id || !parsed?.name) return null
    return normalizePanels([parsed])[0]
  } catch {
    return null
  }
}

export type SharePermission = 'read' | 'edit'

export async function createEncryptedShareHash(panel: Panel, permission: SharePermission): Promise<string> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['encrypt'])
  const plaintext = new TextEncoder().encode(JSON.stringify(panel))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  const payload = new Uint8Array(iv.length + ciphertext.length)
  payload.set(iv, 0)
  payload.set(ciphertext, iv.length)

  const params = new URLSearchParams()
  params.set('share', '1')
  params.set('perm', permission)
  params.set('k', bytesToBase64Url(keyBytes))
  params.set('p', bytesToBase64Url(payload))
  return params.toString()
}

export async function importEncryptedShareHash(hash: string): Promise<{ panel: Panel; permission: SharePermission } | null> {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    if (params.get('share') !== '1') return null
    const permission = (params.get('perm') as SharePermission) || 'read'
    const k = params.get('k')
    const p = params.get('p')
    if (!k || !p) return null
    const keyBytes = base64UrlToBytes(k)
    const payload = base64UrlToBytes(p)
    const iv = new Uint8Array(toArrayBuffer(payload.slice(0, 12)))
    const ciphertext = toArrayBuffer(payload.slice(12))
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['decrypt'])
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
    const json = new TextDecoder().decode(plaintext)
    const parsed = JSON.parse(json) as Panel
    if (!parsed?.id || !parsed?.name) return null
    return { panel: normalizePanels([parsed])[0], permission: permission === 'edit' ? 'edit' : 'read' }
  } catch {
    return null
  }
}
