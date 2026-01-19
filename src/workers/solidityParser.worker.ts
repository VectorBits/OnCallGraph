import { parseSoliditySource } from '../app/solidityParser'

self.onmessage = (ev: MessageEvent) => {
  const payload = ev.data as { code?: string; requestId?: number }
  const code = payload?.code ?? ''
  const requestId = payload?.requestId ?? 0
  const result = parseSoliditySource(code)
  ;(self as unknown as Worker).postMessage({ requestId, result })
}
