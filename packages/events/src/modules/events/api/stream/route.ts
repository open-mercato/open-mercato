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
  userId: string
  roleIds: string[]
  send: (data: string) => void
  close: () => void
}

function collectStringValues(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const values: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    values.push(trimmed)
  }
  return values
}

function normalizeAudience(data: Record<string, unknown>): {
  tenantId: string | null
  organizationScopes: string[]
  recipientUserScopes: string[]
  recipientRoleScopes: string[]
} {
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
  const organizationScopes = new Set<string>()
  if (typeof data.organizationId === 'string' && data.organizationId.trim().length > 0) {
    organizationScopes.add(data.organizationId.trim())
  }
  for (const organizationId of collectStringValues(data.organizationIds)) {
    organizationScopes.add(organizationId)
  }

  const recipientUserScopes = new Set<string>()
  if (typeof data.recipientUserId === 'string' && data.recipientUserId.trim().length > 0) {
    recipientUserScopes.add(data.recipientUserId.trim())
  }
  for (const userId of collectStringValues(data.recipientUserIds)) {
    recipientUserScopes.add(userId)
  }

  const recipientRoleScopes = new Set<string>()
  if (typeof data.recipientRoleId === 'string' && data.recipientRoleId.trim().length > 0) {
    recipientRoleScopes.add(data.recipientRoleId.trim())
  }
  for (const roleId of collectStringValues(data.recipientRoleIds)) {
    recipientRoleScopes.add(roleId)
  }

  return {
    tenantId,
    organizationScopes: Array.from(organizationScopes),
    recipientUserScopes: Array.from(recipientUserScopes),
    recipientRoleScopes: Array.from(recipientRoleScopes),
  }
}

function matchesAudience(conn: SseConnection, audience: ReturnType<typeof normalizeAudience>): boolean {
  if (!audience.tenantId) return false
  if (conn.tenantId !== audience.tenantId) return false

  if (audience.organizationScopes.length > 0) {
    if (!conn.organizationId) return false
    if (!audience.organizationScopes.includes(conn.organizationId)) return false
  }

  if (audience.recipientUserScopes.length > 0 && !audience.recipientUserScopes.includes(conn.userId)) {
    return false
  }

  if (audience.recipientRoleScopes.length > 0) {
    const roleMatched = conn.roleIds.some((roleId) => audience.recipientRoleScopes.includes(roleId))
    if (!roleMatched) return false
  }

  return true
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
    const audience = normalizeAudience(data)

    const ssePayload = JSON.stringify({
      id: eventName,
      payload: data,
      timestamp: Date.now(),
      organizationId: audience.organizationScopes[0] ?? '',
    })

    // Enforce max payload size
    if (new TextEncoder().encode(ssePayload).length > MAX_PAYLOAD_BYTES) {
      console.warn(`[events:stream] Event ${eventName} payload exceeds ${MAX_PAYLOAD_BYTES} bytes, skipping`)
      return
    }

    for (const conn of connections) {
      if (!matchesAudience(conn, audience)) continue

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
  const organizationId = (ctx.selectedOrganizationId as string) ?? ctx.auth.orgId ?? null
  const userId = ctx.auth.sub
  const roleIds = Array.isArray(ctx.auth.roles)
    ? ctx.auth.roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    : []

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
        userId,
        roleIds,
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
    description: 'Long-lived SSE connection that receives server-side events marked with clientBroadcast: true. Events are server-filtered by tenant, organization, recipient user, and recipient role.',
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
