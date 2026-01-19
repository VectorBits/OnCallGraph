import type { ParseResult } from './types'

type Pending = {
  requestId: number
  resolve: (value: ParseResult) => void
  reject: (reason?: unknown) => void
}

let worker: Worker | null = null
let pending: Pending | null = null
let nextRequestId = 1

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/solidityParser.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent) => {
    const data = ev.data as { requestId?: number; result?: ParseResult }
    const nextPending = pending
    pending = null
    if (!nextPending) return
    if (data.requestId !== nextPending.requestId) {
      nextPending.reject(new Error('Parser response was superseded'))
      return
    }
    if (!data.result) {
      nextPending.reject(new Error('Parser returned empty result'))
      return
    }
    nextPending.resolve(data.result)
  }
  worker.onerror = (err) => {
    const nextPending = pending
    pending = null
    nextPending?.reject(err)
  }
  return worker
}

export function parseSolidity(code: string): Promise<ParseResult> {
  if (pending) pending.reject(new Error('Parser was superseded'))
  const w = getWorker()
  return new Promise<ParseResult>((resolve, reject) => {
    const requestId = nextRequestId++
    pending = { requestId, resolve, reject }
    w.postMessage({ code, requestId })
  })
}
