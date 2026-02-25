/**
 * SSE Event Stream — DOM Event Bridge
 *
 * Server-Sent Events endpoint that bridges server-side events to the browser.
 * Only events with `clientBroadcast: true` in their EventDefinition are sent.
 * Events are scoped to the authenticated user's tenant.
 *
 * Client consumer: `packages/ui/src/backend/injection/eventBridge.ts`
 */

import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { isBroadcastEvent } from '@open-mercato/shared/modules/events'
import { registerGlobalEventTap } from '../../../../bus'

export const metadata = {
  GET: { requireAuth: true },
}

const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_PAYLOAD_BYTES = 4096

type SseConnection = {
  tenantId: string
  organizationId: string | null
  send: (data: string) => void
  close: () => void
}

/**
 * Global connection registry.
 * All active SSE connections are tracked here.
 * The event bus subscriber iterates this set on each broadcast event.
 */
const connections = new Set<SseConnection>()

let globalTapRegistered = false

/**
 * Ensure a process-wide event tap is registered (once).
 * This captures emits from all request-scoped EventBus instances.
 */
function ensureGlobalTapSubscription(): void {
  if (globalTapRegistered) return
  globalTapRegistered = true

  registerGlobalEventTap(async (eventName, payload) => {
    if (!eventName || connections.size === 0) return

    // Only bridge events with clientBroadcast: true
    if (!isBroadcastEvent(eventName)) return

    const data = (payload ?? {}) as Record<string, unknown>
    const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
    const organizationId = typeof data.organizationId === 'string' ? data.organizationId : null

    const ssePayload = JSON.stringify({
      id: eventName,
      payload: data,
      timestamp: Date.now(),
      organizationId: organizationId ?? '',
    })

    // Enforce max payload size
    if (new TextEncoder().encode(ssePayload).length > MAX_PAYLOAD_BYTES) {
      console.warn(`[events:stream] Event ${eventName} payload exceeds ${MAX_PAYLOAD_BYTES} bytes, skipping`)
      return
    }

    for (const conn of connections) {
      // Tenant-scoped: only send to connections matching the event's tenant
      if (tenantId && conn.tenantId !== tenantId) continue
      // Organization-scoped: if event has orgId, only send to matching connections
      if (organizationId && conn.organizationId && conn.organizationId !== organizationId) continue

      try {
        conn.send(ssePayload)
      } catch {
        // Connection may have been closed; cleanup happens via abort handler
      }
    }
  })
}

export async function GET(req: Request): Promise<Response> {
  const { ctx } = await resolveRequestContext(req)

  if (!ctx.auth?.tenantId || !ctx.auth?.sub) {
    return new Response('Unauthorized', { status: 401 })
  }

  const tenantId = ctx.auth.tenantId
  const organizationId = (ctx.selectedOrganizationId as string) ?? null

  ensureGlobalTapSubscription()

  const encoder = new TextEncoder()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let connection: SseConnection | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      connection = {
        tenantId,
        organizationId,
        send,
        close: () => controller.close(),
      }
      connections.add(connection)

      // Start heartbeat to keep connection alive
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
      connections.delete(connection)
      connection = null
    }
  }

  // Clean up when client disconnects
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

export const openApi = {
  GET: {
    summary: 'Subscribe to server events via SSE (DOM Event Bridge)',
    description: 'Long-lived SSE connection that receives server-side events marked with clientBroadcast: true. Events are tenant-scoped.',
    tags: ['Events'],
    responses: {
      200: {
        description: 'Event stream (text/event-stream)',
        content: {
          'text/event-stream': {
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Event identifier (e.g., example.todo.created)' },
                payload: { type: 'object', description: 'Event-specific data' },
                timestamp: { type: 'number', description: 'Server timestamp (ms since epoch)' },
                organizationId: { type: 'string', description: 'Organization scope' },
              },
            },
          },
        },
      },
      401: { description: 'Not authenticated' },
    },
  },
}
