/** @jest-environment node */
/**
 * The portal announcement is the module's only `portalBroadcast` event, and it is
 * produced by a wildcard subscriber that re-emits onto the same bus it listens to.
 * Three things therefore have to hold, and none of them are visible by reading the
 * declaration:
 *
 * 1. `portalBroadcast: true` must reach the shared event registry, because that is
 *    what the portal SSE endpoint consults (`isPortalBroadcastEvent`) before it
 *    forwards anything.
 * 2. The subscriber's `example.todo.*` pattern must NOT match the announcement it
 *    emits, or every write becomes an infinite fan-out. Checked with the real
 *    matcher, not by eye.
 * 3. The payload must carry scope and nothing staff-authored — a portal broadcast
 *    reaches customers.
 */
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { isPortalBroadcastEvent, isBroadcastEvent } from '@open-mercato/shared/modules/events'
import '../events'
import handler, {
  buildTodoAnnouncement,
  metadata,
} from '../subscribers/announce-todo-to-portal'

const ANNOUNCEMENT_EVENT = 'example.todo_announcement.published'
const WRITE_EVENTS = ['example.todo.created', 'example.todo.updated', 'example.todo.deleted']

describe('portal broadcast declaration', () => {
  it('registers the announcement as a portal broadcast in the shared registry', () => {
    expect(isPortalBroadcastEvent(ANNOUNCEMENT_EVENT)).toBe(true)
  })

  it('keeps the announcement off the backoffice DOM bridge', () => {
    expect(isBroadcastEvent(ANNOUNCEMENT_EVENT)).toBe(false)
  })

  it('leaves the internal todo writes off the portal bridge', () => {
    for (const eventId of WRITE_EVENTS) {
      expect(isPortalBroadcastEvent(eventId)).toBe(false)
    }
  })
})

describe('subscriber pattern', () => {
  it('matches every internal todo write', () => {
    for (const eventId of WRITE_EVENTS) {
      expect(matchEventPattern(eventId, metadata.event)).toBe(true)
    }
  })

  it('cannot match the announcement it emits', () => {
    expect(matchEventPattern(ANNOUNCEMENT_EVENT, metadata.event)).toBe(false)
  })
})

describe('buildTodoAnnouncement', () => {
  const payload = {
    id: 'todo-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  it('projects id, scope and action, and nothing else', () => {
    const announcement = buildTodoAnnouncement(payload, 'example.todo.updated')
    expect(announcement).toEqual({
      todoId: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      action: 'updated',
    })
  })

  it('drops staff-authored fields that arrive on the source payload', () => {
    const announcement = buildTodoAnnouncement(
      { ...payload, title: 'Call the auditor', notes: 'account 12345' } as typeof payload,
      'example.todo.created',
    )
    expect(Object.keys(announcement ?? {}).sort()).toEqual([
      'action',
      'organizationId',
      'tenantId',
      'todoId',
    ])
  })

  it.each([
    ['no tenant', { ...payload, tenantId: null }, 'example.todo.updated'],
    ['no organization', { ...payload, organizationId: null }, 'example.todo.updated'],
    ['no record id', { ...payload, id: null }, 'example.todo.updated'],
    ['blank tenant', { ...payload, tenantId: '   ' }, 'example.todo.updated'],
    ['no event name', payload, null],
  ])('returns null with %s', (_label, input, eventName) => {
    expect(buildTodoAnnouncement(input, eventName)).toBeNull()
  })
})

describe('handler', () => {
  it('stays silent when the write is unscoped', async () => {
    await expect(
      handler({ id: 'todo-1', tenantId: null, organizationId: null }, { eventName: 'example.todo.updated' }),
    ).resolves.toBeUndefined()
  })

  it('swallows an emit failure so the committed write is not reported as failed', async () => {
    const globalKey = '__openMercatoGlobalEventBus__'
    const previous = (globalThis as Record<string, unknown>)[globalKey]
    const emit = jest.fn().mockRejectedValue(new Error('bus down'))
    ;(globalThis as Record<string, unknown>)[globalKey] = { emit }
    try {
      await expect(
        handler(
          { id: 'todo-1', tenantId: 'tenant-1', organizationId: 'org-1' },
          { eventName: 'example.todo.deleted' },
        ),
      ).resolves.toBeUndefined()
      expect(emit).toHaveBeenCalledWith(
        ANNOUNCEMENT_EVENT,
        { todoId: 'todo-1', tenantId: 'tenant-1', organizationId: 'org-1', action: 'deleted' },
        undefined,
      )
    } finally {
      ;(globalThis as Record<string, unknown>)[globalKey] = previous
    }
  })
})
