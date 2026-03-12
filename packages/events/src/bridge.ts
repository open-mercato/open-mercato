import { Client, Pool } from 'pg'
import type { EmitOptions, EventPayload } from './types'

const BRIDGE_CHANNEL = 'om_event_bridge'
const MAX_MESSAGE_BYTES = 7_000
const RECONNECT_DELAY_MS = 1_000

type BridgeEnvelope = {
  event: string
  payload: EventPayload
  options?: EmitOptions
  originPid: number
}

type CrossProcessEventListener = (envelope: BridgeEnvelope) => void | Promise<void>
type PgNotificationMessage = {
  channel: string
  payload?: string
}

let publisherPool: InstanceType<typeof Pool> | null | undefined
let listenerClient: InstanceType<typeof Client> | null = null
let listenerConnectPromise: Promise<void> | null = null
let listenerReconnectTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<CrossProcessEventListener>()

function getDatabaseUrl(): string | null {
  const value = process.env.DATABASE_URL?.trim()
  return value && value.length > 0 ? value : null
}

function getPublisherPool(): InstanceType<typeof Pool> | null {
  if (publisherPool !== undefined) return publisherPool
  const connectionString = getDatabaseUrl()
  if (!connectionString) {
    publisherPool = null
    return null
  }
  publisherPool = new Pool({
    connectionString,
    max: 2,
  })
  return publisherPool
}

async function dispatchEnvelope(envelope: BridgeEnvelope): Promise<void> {
  for (const listener of listeners) {
    try {
      await Promise.resolve(listener(envelope))
    } catch (error) {
      console.error(`[events] Cross-process listener error for "${envelope.event}":`, error)
    }
  }
}

function clearReconnectTimer(): void {
  if (!listenerReconnectTimer) return
  clearTimeout(listenerReconnectTimer)
  listenerReconnectTimer = null
}

async function closeListenerClient(): Promise<void> {
  if (!listenerClient) return
  const client = listenerClient
  listenerClient = null
  try {
    client.removeAllListeners('notification')
    client.removeAllListeners('error')
    client.removeAllListeners('end')
    await client.end()
  } catch {
    // Ignore shutdown errors.
  }
}

function scheduleReconnect(): void {
  if (listenerReconnectTimer || listeners.size === 0) return
  listenerReconnectTimer = setTimeout(() => {
    listenerReconnectTimer = null
    void ensureCrossProcessListener()
  }, RECONNECT_DELAY_MS)
}

async function ensureCrossProcessListener(): Promise<void> {
  if (listenerClient || listenerConnectPromise || listeners.size === 0) return
  const connectionString = getDatabaseUrl()
  if (!connectionString) return

  listenerConnectPromise = (async () => {
    const client = new Client({ connectionString })

    client.on('notification', (message: PgNotificationMessage) => {
      if (message.channel !== BRIDGE_CHANNEL || !message.payload) return
      try {
        const parsed = JSON.parse(message.payload) as BridgeEnvelope
        if (!parsed || typeof parsed.event !== 'string') return
        void dispatchEnvelope(parsed)
      } catch (error) {
        console.warn('[events] Failed to parse cross-process bridge payload:', error)
      }
    })

    const handleDisconnect = () => {
      if (listenerClient === client) {
        listenerClient = null
      }
      scheduleReconnect()
    }

    client.on('error', handleDisconnect)
    client.on('end', handleDisconnect)

    await client.connect()
    await client.query(`LISTEN ${BRIDGE_CHANNEL}`)
    listenerClient = client
  })()
    .catch((error) => {
      console.warn('[events] Cross-process event bridge listener failed:', error)
      scheduleReconnect()
    })
    .finally(() => {
      listenerConnectPromise = null
    })

  await listenerConnectPromise
}

export async function publishCrossProcessEvent(
  event: string,
  payload: EventPayload,
  options?: EmitOptions,
): Promise<void> {
  const pool = getPublisherPool()
  if (!pool) return

  const envelope: BridgeEnvelope = {
    event,
    payload,
    options,
    originPid: process.pid,
  }

  const serialized = JSON.stringify(envelope)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MESSAGE_BYTES) {
    console.warn(`[events] Cross-process event "${event}" dropped: payload exceeds ${MAX_MESSAGE_BYTES} bytes`)
    return
  }

  await pool.query('SELECT pg_notify($1, $2)', [BRIDGE_CHANNEL, serialized])
}

export function registerCrossProcessEventListener(listener: CrossProcessEventListener): () => void {
  listeners.add(listener)
  void ensureCrossProcessListener()

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearReconnectTimer()
      void closeListenerClient()
    }
  }
}
