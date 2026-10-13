/**
 * Portal SSE Event Stream — Portal Event Bridge
 *
 * Server-Sent Events endpoint that bridges server-side events to the customer portal.
 * Only events with `portalBroadcast: true` in their EventDefinition are sent.
 * Events are scoped to the authenticated customer's tenant and organization.
 *
 * Uses customer JWT auth (cookie or Bearer token) instead of staff auth.
 * The customer session is re-checked periodically and every connection has a
 * bounded, jittered lifetime, so revoked sessions stop receiving events.
 *
 * Client consumer: `packages/ui/src/portal/hooks/usePortalEventBridge.ts`
 */

import { NextResponse } from 'next/server'
import { isPortalBroadcastEvent } from '@open-mercato/shared/modules/events'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

const HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_AUTH_REVALIDATION_INTERVAL_MS = 30_000
const DEFAULT_CONNECTION_MAX_AGE_MS = 5 * 60_000
const MIN_AUTH_REVALIDATION_INTERVAL_MS = 1_000
const MIN_CONNECTION_MAX_AGE_MS = 1_000
const CONNECTION_MAX_AGE_JITTER_RATIO = 0.15
const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_PAYLOAD_BYTES = 4096

type PortalSseIdentity = {
  tenantId: string
  organizationId: string
  customerUserId: string
  sessionId: string
}

type PortalSseConnection = {
  tenantId: string
  organizationId: string
  customerUserId: string
  send: (data: string) => void
  close: () => void
}

function resolveTimingConfig(): {
  authRevalidationIntervalMs: number
  connectionMaxAgeMs: number
} {
  return {
    authRevalidationIntervalMs: Math.min(
      parseNumberWithDefault(
        process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS,
        DEFAULT_AUTH_REVALIDATION_INTERVAL_MS,
        { integer: true, min: MIN_AUTH_REVALIDATION_INTERVAL_MS },
      ),
      MAX_TIMER_DELAY_MS,
    ),
    connectionMaxAgeMs: applyConnectionMaxAgeJitter(
      parseNumberWithDefault(
        process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS,
        DEFAULT_CONNECTION_MAX_AGE_MS,
        { integer: true, min: MIN_CONNECTION_MAX_AGE_MS },
      ),
    ),
  }
}

function applyConnectionMaxAgeJitter(configuredMs: number): number {
  const jitterFactor = 1 + (Math.random() * 2 - 1) * CONNECTION_MAX_AGE_JITTER_RATIO
  const jitteredMs = Math.round(configuredMs * jitterFactor)
  return Math.min(Math.max(jitteredMs, MIN_CONNECTION_MAX_AGE_MS), MAX_TIMER_DELAY_MS)
}

function toIdentity(auth: CustomerAuthContext): PortalSseIdentity {
  return {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    customerUserId: auth.sub,
    sessionId: auth.sid,
  }
}

function identitiesMatch(left: PortalSseIdentity, right: PortalSseIdentity): boolean {
  return left.tenantId === right.tenantId
    && left.organizationId === right.organizationId
    && left.customerUserId === right.customerUserId
    && left.sessionId === right.sessionId
}

function createAuthRevalidationRequest(req: Request): Request {
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
  })
}

function normalizeAudience(data: Record<string, unknown>): {
  tenantId: string | null
  organizationScopes: string[]
  recipientUserScopes: string[]
} {
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
  const organizationScopes = new Set<string>()
  if (typeof data.organizationId === 'string' && data.organizationId.trim().length > 0) {
    organizationScopes.add(data.organizationId.trim())
  }
  if (Array.isArray(data.organizationIds)) {
    for (const orgId of data.organizationIds) {
      if (typeof orgId === 'string' && orgId.trim().length > 0) {
        organizationScopes.add(orgId.trim())
      }
    }
  }

  const recipientUserScopes = new Set<string>()
  if (typeof data.recipientUserId === 'string' && data.recipientUserId.trim().length > 0) {
    recipientUserScopes.add(data.recipientUserId.trim())
  }
  if (Array.isArray(data.recipientUserIds)) {
    for (const userId of data.recipientUserIds) {
      if (typeof userId === 'string' && userId.trim().length > 0) {
        recipientUserScopes.add(userId.trim())
      }
    }
  }

  return {
    tenantId,
    organizationScopes: Array.from(organizationScopes),
    recipientUserScopes: Array.from(recipientUserScopes),
  }
}

function matchesAudience(conn: PortalSseConnection, audience: ReturnType<typeof normalizeAudience>): boolean {
  if (!audience.tenantId) return false
  if (conn.tenantId !== audience.tenantId) return false
  if (audience.organizationScopes.length > 0) {
    if (!audience.organizationScopes.includes(conn.organizationId)) return false
  }
  if (audience.recipientUserScopes.length > 0 && !audience.recipientUserScopes.includes(conn.customerUserId)) {
    return false
  }
  return true
}

const portalConnections = new Set<PortalSseConnection>()

let portalTapRegistered = false

async function broadcastPortalEvent(eventName: string, payload: Record<string, unknown>): Promise<void> {
  if (!eventName || portalConnections.size === 0) return
  if (!isPortalBroadcastEvent(eventName)) return

  const data = payload ?? {}
  const audience = normalizeAudience(data)
  const organizationId = audience.organizationScopes[0] ?? ''

  let ssePayload = JSON.stringify({
    id: eventName,
    payload: data,
    timestamp: Date.now(),
    organizationId,
  })

  if (new TextEncoder().encode(ssePayload).length > MAX_PAYLOAD_BYTES) {
    const entityRef: Record<string, unknown> = { truncated: true }
    if (typeof data.id === 'string' && data.id.trim().length > 0) entityRef.id = data.id.trim()
    if (typeof data.entityId === 'string' && data.entityId.trim().length > 0) entityRef.entityId = data.entityId.trim()
    ssePayload = JSON.stringify({
      id: eventName,
      payload: entityRef,
      timestamp: Date.now(),
      organizationId,
    })
    if (new TextEncoder().encode(ssePayload).length > MAX_PAYLOAD_BYTES) {
      return
    }
  }

  for (const conn of portalConnections) {
    if (!matchesAudience(conn, audience)) continue
    try {
      conn.send(ssePayload)
    } catch {
      // Connection may have been closed
    }
  }
}

function ensurePortalTap(): void {
  if (portalTapRegistered) return
  portalTapRegistered = true

  // Dynamically import to avoid circular dependency — the events bus
  // registers a global tap that fires for every emitted event.
  import('@open-mercato/events/bus').then(({ registerGlobalEventTap, registerCrossProcessEventListener }) => {
    registerGlobalEventTap(async (eventName, payload) => {
      await broadcastPortalEvent(eventName, (payload ?? {}) as Record<string, unknown>)
    })

    registerCrossProcessEventListener(async (envelope) => {
      if (envelope.originPid === process.pid) return
      await broadcastPortalEvent(
        envelope.event,
        (envelope.payload ?? {}) as Record<string, unknown>,
      )
    })
  }).catch(() => {
    // Silently ignore if events package is not available
    portalTapRegistered = false
  })
}

export async function GET(req: Request): Promise<Response> {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }
  const authorizedIdentity = toIdentity(auth)
  const { authRevalidationIntervalMs, connectionMaxAgeMs } = resolveTimingConfig()

  ensurePortalTap()

  const encoder = new TextEncoder()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let authRevalidationTimer: ReturnType<typeof setInterval> | null = null
  let maxAgeTimer: ReturnType<typeof setTimeout> | null = null
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  let connection: PortalSseConnection | null = null
  let authRevalidationInFlight = false
  let cleanedUp = false
  const onAbort = () => closeConnection()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      const send = (data: string) => {
        if (cleanedUp) return
        try {
          streamController?.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          closeConnection()
        }
      }

      connection = {
        tenantId: authorizedIdentity.tenantId,
        organizationId: authorizedIdentity.organizationId,
        customerUserId: authorizedIdentity.customerUserId,
        send,
        close: closeConnection,
      }
      portalConnections.add(connection)

      // Flush an initial comment so the runtime sends the response headers and
      // first body byte immediately, firing the browser EventSource `open`
      // event without waiting for the first heartbeat (30s) or matching event.
      // Comment lines (`:` prefix) are ignored by EventSource message parsing.
      controller.enqueue(encoder.encode(': connected\n\n'))

      heartbeatTimer = setInterval(() => {
        try {
          streamController?.enqueue(encoder.encode(':heartbeat\n\n'))
        } catch {
          closeConnection()
        }
      }, HEARTBEAT_INTERVAL_MS)

      authRevalidationTimer = setInterval(() => {
        void revalidateAuthorization()
      }, authRevalidationIntervalMs)

      maxAgeTimer = setTimeout(() => {
        closeConnection()
      }, connectionMaxAgeMs)
    },
    cancel() {
      cleanup()
    },
  })

  async function revalidateAuthorization(): Promise<void> {
    if (cleanedUp || authRevalidationInFlight) return
    authRevalidationInFlight = true
    try {
      const freshAuth = await getCustomerAuthFromRequest(createAuthRevalidationRequest(req))
      if (cleanedUp) return
      if (!freshAuth || !identitiesMatch(authorizedIdentity, toIdentity(freshAuth))) {
        closeConnection()
      }
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, {
        module: 'customer_accounts',
        code: 'customer_accounts.portal_sse_revalidation_failed',
      })
      closeConnection()
    } finally {
      authRevalidationInFlight = false
    }
  }

  function closeConnection(): void {
    if (cleanedUp) return
    const controller = streamController
    cleanup()
    try {
      controller?.close()
    } catch {}
  }

  function cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (authRevalidationTimer) {
      clearInterval(authRevalidationTimer)
      authRevalidationTimer = null
    }
    if (maxAgeTimer) {
      clearTimeout(maxAgeTimer)
      maxAgeTimer = null
    }
    if (connection) {
      portalConnections.delete(connection)
      connection = null
    }
    streamController = null
    // Detach from the request signal so reconnect churn does not accumulate
    // listeners and closures on long-lived AbortSignals.
    req.signal.removeEventListener('abort', onAbort)
  }

  req.signal.addEventListener('abort', onAbort, { once: true })
  if (req.signal.aborted) onAbort()

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

const methodDoc: OpenApiMethodDoc = {
  summary: 'Subscribe to portal events via SSE (Portal Event Bridge)',
  description: 'Server-bounded SSE connection that receives server-side events marked with portalBroadcast: true. Events are filtered by the customer\'s tenant, organization, and recipient user audience. The customer session is revalidated periodically and the connection is closed once the session is no longer valid or its bounded lifetime ends; clients must reconnect.',
  tags: ['Customer Portal'],
  responses: [
    {
      status: 200,
      description: 'Event stream (text/event-stream)',
    },
  ],
  errors: [
    { status: 401, description: 'Not authenticated' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Portal event stream',
  methods: { GET: methodDoc },
}
