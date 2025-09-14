import fs from 'node:fs'
import path from 'node:path'
import { EventStrategy, QueuedEvent, SubscriberDescriptor, SubscriberHandler } from '../types'

type LocalState = { lastProcessedId?: number }

export function createLocalStrategy(baseDir = path.resolve('.events'), deliver?: (event: string, payload: any) => Promise<void>): EventStrategy {
  const listeners = new Map<string, Set<SubscriberHandler>>()
  const queueFile = path.join(baseDir, 'queue.json')
  const stateFile = path.join(baseDir, 'state.json')

  function ensureDir() {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true })
    if (!fs.existsSync(queueFile)) fs.writeFileSync(queueFile, '[]', 'utf8')
    if (!fs.existsSync(stateFile)) fs.writeFileSync(stateFile, '{}', 'utf8')
  }

  function readQueue(): QueuedEvent[] {
    ensureDir()
    try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')) as QueuedEvent[] } catch { return [] }
  }

  function writeQueue(list: QueuedEvent[]) {
    ensureDir()
    fs.writeFileSync(queueFile, JSON.stringify(list), 'utf8')
  }

  function readState(): LocalState {
    ensureDir()
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as LocalState } catch { return {} }
  }

  function writeState(s: LocalState) {
    ensureDir()
    fs.writeFileSync(stateFile, JSON.stringify(s), 'utf8')
  }

  function nextId(list: QueuedEvent[]) {
    return list.length ? Math.max(...list.map((e) => e.id)) + 1 : 1
  }

  function on(event: string, handler: SubscriberHandler) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(handler)
  }

  function registerModuleSubscribers(subs: SubscriberDescriptor[]) {
    for (const s of subs) on(s.event, s.handler)
  }

  async function emit(evt: Omit<QueuedEvent, 'id' | 'createdAt'> & { createdAt?: string }) {
    const createdAt = evt.createdAt || new Date().toISOString()
    if (deliver) await deliver(evt.event, evt.payload)
    if (evt.persistent) {
      const list = readQueue()
      const q: QueuedEvent = { id: nextId(list), event: evt.event, payload: evt.payload, persistent: true, createdAt }
      list.push(q)
      writeQueue(list)
    }
  }

  async function processOffline(opts?: { limit?: number }) {
    const state = readState()
    const since = state.lastProcessedId || 0
    const list = readQueue()
    const pending = list.filter((e) => e.id > since)
    const slice = typeof opts?.limit === 'number' ? pending.slice(0, opts.limit) : pending
    let lastId = since
    for (const e of slice) {
      if (deliver) await deliver(e.event, e.payload)
      lastId = e.id
    }
    if (lastId !== since) writeState({ lastProcessedId: lastId })
    return { processed: slice.length, lastId }
  }

  return { emit, on, registerModuleSubscribers, processOffline }
}

