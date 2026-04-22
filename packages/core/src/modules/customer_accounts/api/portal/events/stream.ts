/**
 * Portal SSE Event Stream — Portal Event Bridge
 *
 * Server-Sent Events endpoint that bridges server-side events to the customer portal.
 * Only events with `portalBroadcast: true` in their EventDefinition are sent.
 * Events are scoped to the authenticated customer's tenant and organization.
 *
 * Uses customer JWT auth (cookie or Bearer token) instead of staff auth.
 *
 * Client consumer: `packages/ui/src/portal/hooks/usePortalEventBridge.ts`
 */

import { NextResponse } from 'next/server'
import { isPortalBroadcastEvent } from '@open-mercato/shared/modules/events'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'

export const metadata: { path?: string } = {}

const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_PAYLOAD_BYTES = 4096

type PortalSseConnection = {
  tenantId: string
  organizationId: string
  customerUserId: string
  send: (data: string) => void
  close: () => void
}

function normalizeAudience(data: Record<string, unknown>): {
  tenantId: string | null
  organizationScopes: string[]
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
  return { tenantId, organizationScopes: Array.from(organizationScopes) }
}

function matchesAudience(conn: PortalSseConnection, audience: ReturnType<typeof normalizeAudience>): boolean {
  if (!audience.tenantId) return false
  if (conn.tenantId !== audience.tenantId) return false
  if (audience.organizationScopes.length > 0) {
    if (!audience.organizationScopes.includes(conn.organizationId)) return false
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

  ensurePortalTap()

  const encoder = new TextEncoder()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let connection: PortalSseConnection | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      connection = {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        customerUserId: auth.sub,
        send,
        close: () => controller.close(),
      }
      portalConnections.add(connection)

      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':heartbeat\n\n'))
        } catch {
          // Stream may have been closed
        }
      }, HEARTBEAT_INTERVAL_MS)
    },
    cancel() {
      cleanup()
    },
  })

  function cleanup() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (connection) {
      portalConnections.delete(connection)
      connection = null
    }
  }

  req.signal.addEventListener('abort', cleanup)

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
  description: 'Long-lived SSE connection that receives server-side events marked with portalBroadcast: true. Events are filtered by the customer\'s tenant and organization.',
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
