import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitExampleEvent } from '../events'

const logger = createLogger('example').child({ subscriber: 'announce-todo-to-portal' })

/**
 * Bridges an internal todo write onto the Portal Event Bridge.
 *
 * The customer portal has no visibility into `example.todo.*` — those are staff-side
 * CRUD events, and the portal SSE endpoint only forwards events declared with
 * `portalBroadcast: true`. This subscriber is the seam: it turns a write it does not
 * own into the one customer-facing announcement this module does own
 * (`example.todo_announcement.published`, declared in `events.ts`).
 *
 * Wildcard subscription, so all three write paths land here and `ctx.eventName` — the
 * concrete event id the dispatcher matched — supplies the action. `example.todo.*` is
 * single-segment, so it cannot match `example.todo_announcement.published` and the
 * announcement can never re-enter this handler. `__tests__/announce-todo-to-portal.test.ts`
 * pins that with the real matcher rather than trusting this paragraph.
 *
 * Ephemeral (`persistent: false`): a missed portal notification is not worth a queue
 * row, and the portal client re-reads on reconnect anyway.
 */
export const metadata = {
  event: 'example.todo.*',
  persistent: false,
  id: 'example:announce-todo-to-portal',
}

/** Default CRUD payload the data engine builds for `example.todo.<action>`. */
export type TodoWritePayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export type TodoAnnouncement = {
  todoId: string
  tenantId: string
  organizationId: string
  action: string
}

/**
 * Pure payload projection, exported so `__tests__/announce-todo-to-portal.test.ts`
 * can pin both the audience-scoping rule and the field whitelist directly.
 *
 * Two rules it enforces:
 *
 * - Returns `null` without a tenant AND an organization. `matchesAudience` in the
 *   portal stream drops a payload with no `tenantId` anyway, so emitting one would
 *   just put an unaddressable record on the bus.
 * - Copies only ids, scope and the action. The todo's title and its encrypted notes
 *   are staff-authored and never reach a customer-facing transport.
 */
export function buildTodoAnnouncement(
  payload: TodoWritePayload,
  eventName: string | null | undefined,
): TodoAnnouncement | null {
  const todoId = typeof payload?.id === 'string' ? payload.id.trim() : ''
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId.trim() : ''
  const organizationId = typeof payload?.organizationId === 'string' ? payload.organizationId.trim() : ''
  if (!todoId || !tenantId || !organizationId) return null
  const action = typeof eventName === 'string' ? eventName.split('.').pop() ?? '' : ''
  if (!action) return null
  return { todoId, tenantId, organizationId, action }
}

export type PortalAnnouncementContext = {
  eventName?: string | null
}

export default async function handler(
  payload: TodoWritePayload,
  ctx: PortalAnnouncementContext,
): Promise<void> {
  const announcement = buildTodoAnnouncement(payload, ctx?.eventName)
  if (!announcement) return

  try {
    await emitExampleEvent('example.todo_announcement.published', announcement)
  } catch (error) {
    // Best effort: the domain write already committed and the portal reconciles on
    // reconnect, so a failed announcement must not surface as a write failure.
    logger.warn('Failed to publish portal todo announcement', {
      err: error,
      tenantId: announcement.tenantId,
    })
  }
}
