/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const mockEmitStaffEvent = jest.fn()
const mockResolvePortalRecipients = jest.fn()
const mockFilterPortalRecipients = jest.fn()

jest.mock('../../../events', () => ({
  emitStaffEvent: (...args: unknown[]) => mockEmitStaffEvent(...args),
}))

jest.mock('../../time-tracking/portalRecipients', () => ({
  resolvePortalRecipientUserIdsStrict: (...args: unknown[]) => mockResolvePortalRecipients(...args),
  filterPortalRecipientsByFeatureStrict: (...args: unknown[]) => mockFilterPortalRecipients(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) => em.findOne(cls, where)),
}))

import { PORTAL_FANOUT_BATCH_SIZE, fanOutStatusColumn, publishTaskPortalStatus } from '../portalBroadcast'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

type TaskRow = { id: string; taskStatusId: string; customerId: string | null; source: string; timeProjectId: string; tenantId: string; organizationId: string; deletedAt: Date | null; updatedAt?: Date }
type TicketRow = { id: string; taskId: string; supportReference: string; portalStatusPublished: string | null; updatedAt: Date; deletedAt: Date | null }
type StatusRow = { id: string; isDefault: boolean; isDone: boolean }

type World = { tasks: TaskRow[]; tickets: TicketRow[]; statuses: StatusRow[] }

function task(id: string, taskStatusId: string): TaskRow {
  return { id, taskStatusId, customerId: 'customer-1', source: 'portal', timeProjectId: 'project-1', ...SCOPE, deletedAt: null }
}

function ticket(taskId: string, portalStatusPublished: string | null): TicketRow {
  return { id: `ticket-${taskId}`, taskId, supportReference: `SUP-${taskId}`, portalStatusPublished, updatedAt: new Date(0), deletedAt: null }
}

function makeEm(world: World) {
  const flush = jest.fn(async () => undefined)
  const findCalls: { limit?: number; offset?: number }[] = []
  const em: Record<string, unknown> = {
    flush,
    findOne: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      if (cls.name === 'StaffTimeTask') {
        return world.tasks.find((row) => row.id === where.id && row.source === where.source && row.deletedAt === null) ?? null
      }
      if (cls.name === 'StaffSupportTicket') return world.tickets.find((row) => row.taskId === where.taskId && row.deletedAt === null) ?? null
      if (cls.name === 'StaffTimeTaskStatus') return world.statuses.find((row) => row.id === where.id) ?? null
      return null
    }),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>, options: { limit: number; offset: number }) => {
      findCalls.push({ limit: options.limit, offset: options.offset })
      if (cls.name !== 'StaffTimeTask') return []
      const matching = world.tasks
        .filter((row) => row.taskStatusId === where.taskStatusId && row.source === 'portal' && row.deletedAt === null)
        .sort((left, right) => left.id.localeCompare(right.id))
      return matching.slice(options.offset, options.offset + options.limit).map((row) => ({ id: row.id }))
    }),
  }
  em.fork = jest.fn(() => em)
  return { em: em as unknown as EntityManager, flush, findCalls }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmitStaffEvent.mockResolvedValue(undefined)
  mockResolvePortalRecipients.mockResolvedValue(['portal-user-1'])
  mockFilterPortalRecipients.mockImplementation(async (_em: unknown, userIds: string[]) => userIds)
})

function portalUpdates() {
  return mockEmitStaffEvent.mock.calls.filter(([eventId]) => eventId === 'staff.support_ticket.portal_updated')
}

describe('publishTaskPortalStatus', () => {
  it('publishes and records the status when it changed', async () => {
    const world: World = {
      tasks: [task('t1', 'progress')],
      tickets: [ticket('t1', 'received')],
      statuses: [{ id: 'progress', isDefault: false, isDone: false }],
    }
    const { em, flush } = makeEm(world)

    await expect(publishTaskPortalStatus(em, 't1', SCOPE)).resolves.toBe(true)

    expect(world.tickets[0].portalStatusPublished).toBe('in_progress')
    expect(flush).toHaveBeenCalledTimes(1)
    expect(portalUpdates()).toHaveLength(1)
    expect(portalUpdates()[0][1]).toEqual(expect.objectContaining({ portalStatus: 'in_progress', kind: 'status', recipientUserIds: ['portal-user-1'] }))
  })

  it('emits nothing and writes nothing when the derived status is unchanged', async () => {
    const world: World = {
      tasks: [task('t1', 'done')],
      tickets: [ticket('t1', 'resolved')],
      statuses: [{ id: 'done', isDefault: false, isDone: true }],
    }
    const { em, flush } = makeEm(world)

    await expect(publishTaskPortalStatus(em, 't1', SCOPE)).resolves.toBe(false)

    expect(flush).not.toHaveBeenCalled()
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  it('still publishes an unchanged status for a status-change trigger, without rewriting the record', async () => {
    const world: World = {
      tasks: [task('t1', 'done')],
      tickets: [ticket('t1', 'resolved')],
      statuses: [{ id: 'done', isDefault: false, isDone: true }],
    }
    const { em, flush } = makeEm(world)

    await expect(publishTaskPortalStatus(em, 't1', SCOPE, { always: true })).resolves.toBe(true)

    expect(flush).not.toHaveBeenCalled()
    expect(portalUpdates()).toHaveLength(1)
    expect(portalUpdates()[0][1]).toEqual(expect.objectContaining({ portalStatus: 'resolved', kind: 'status' }))
  })

  it('tags each status announcement with the task version, so the portal bridge never collapses two different changes', async () => {
    const first = { ...task('t1', 'done'), updatedAt: new Date('2026-10-14T10:00:00.000Z') }
    const world: World = {
      tasks: [first],
      tickets: [ticket('t1', 'resolved')],
      statuses: [{ id: 'done', isDefault: false, isDone: true }],
    }
    const { em } = makeEm(world)

    await publishTaskPortalStatus(em, 't1', SCOPE, { always: true })
    first.updatedAt = new Date('2026-10-14T10:00:00.400Z')
    await publishTaskPortalStatus(em, 't1', SCOPE, { always: true })

    const versions = portalUpdates().map((call) => (call[1] as { version?: string }).version)
    expect(versions).toEqual(['2026-10-14T10:00:00.000Z', '2026-10-14T10:00:00.400Z'])
  })

  it('ignores internal tasks and tasks without a ticket row', async () => {
    const internal = { ...task('t1', 'progress'), source: 'internal' }
    const { em } = makeEm({ tasks: [internal, task('t2', 'progress')], tickets: [], statuses: [] })

    await expect(publishTaskPortalStatus(em, 't1', SCOPE)).resolves.toBe(false)
    await expect(publishTaskPortalStatus(em, 't2', SCOPE)).resolves.toBe(false)
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  it('never emits a portal update with an empty recipient list', async () => {
    mockResolvePortalRecipients.mockResolvedValue([])
    const world: World = {
      tasks: [task('t1', 'progress')],
      tickets: [ticket('t1', 'received')],
      statuses: [{ id: 'progress', isDefault: false, isDone: false }],
    }
    const { em } = makeEm(world)

    await publishTaskPortalStatus(em, 't1', SCOPE)

    expect(portalUpdates()).toHaveLength(0)
  })

  it('addresses only the customer users that hold the portal support view feature', async () => {
    mockResolvePortalRecipients.mockResolvedValue(['portal-user-1', 'portal-user-2'])
    mockFilterPortalRecipients.mockResolvedValue(['portal-user-2'])
    const world: World = {
      tasks: [task('t1', 'progress')],
      tickets: [ticket('t1', 'received')],
      statuses: [{ id: 'progress', isDefault: false, isDone: false }],
    }
    const { em } = makeEm(world)

    await publishTaskPortalStatus(em, 't1', SCOPE)

    expect(mockFilterPortalRecipients).toHaveBeenCalledWith(em, ['portal-user-1', 'portal-user-2'], SCOPE, 'portal.support_tickets.view')
    expect(portalUpdates()).toHaveLength(1)
    expect(portalUpdates()[0][1]).toEqual(expect.objectContaining({ recipientUserIds: ['portal-user-2'] }))
  })

  it('emits nothing when no customer user holds the portal support view feature', async () => {
    mockFilterPortalRecipients.mockResolvedValue([])
    const world: World = {
      tasks: [task('t1', 'progress')],
      tickets: [ticket('t1', 'received')],
      statuses: [{ id: 'progress', isDefault: false, isDone: false }],
    }
    const { em } = makeEm(world)

    await publishTaskPortalStatus(em, 't1', SCOPE)

    expect(portalUpdates()).toHaveLength(0)
  })
})

describe('fanOutStatusColumn', () => {
  it('walks the column in fixed-size batches and publishes only changed tickets', async () => {
    const total = PORTAL_FANOUT_BATCH_SIZE + 3
    const ids = Array.from({ length: total }, (_, index) => `t${String(index).padStart(4, '0')}`)
    const world: World = {
      tasks: ids.map((id) => task(id, 'done')),
      tickets: ids.map((id, index) => ticket(id, index === 0 ? 'resolved' : 'in_progress')),
      statuses: [{ id: 'done', isDefault: false, isDone: true }],
    }
    const { em, findCalls } = makeEm(world)

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(total - 1)

    expect(findCalls).toEqual([
      { limit: PORTAL_FANOUT_BATCH_SIZE, offset: 0 },
      { limit: PORTAL_FANOUT_BATCH_SIZE, offset: PORTAL_FANOUT_BATCH_SIZE },
    ])
    expect(portalUpdates()).toHaveLength(total - 1)
    expect(world.tickets.every((row) => row.portalStatusPublished === 'resolved')).toBe(true)
  })

  it.each([
    ['recipient resolution', () => mockResolvePortalRecipients.mockRejectedValueOnce(new Error('[internal] recipients unavailable'))],
    ['the portal update emit', () => mockEmitStaffEvent.mockRejectedValueOnce(new Error('[internal] bus unavailable'))],
  ])('keeps the dedup marker when %s fails, so the subscriber retry still publishes', async (_label, failOnce) => {
    const world: World = {
      tasks: [task('t1', 'done')],
      tickets: [ticket('t1', 'in_progress')],
      statuses: [{ id: 'done', isDefault: false, isDone: true }],
    }
    const { em, flush } = makeEm(world)
    failOnce()

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).rejects.toThrow('[internal]')

    expect(world.tickets[0].portalStatusPublished).toBe('in_progress')
    expect(flush).not.toHaveBeenCalled()
    mockEmitStaffEvent.mockClear()

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(1)

    expect(portalUpdates()).toHaveLength(1)
    expect(portalUpdates()[0][1]).toEqual(expect.objectContaining({ portalStatus: 'resolved', kind: 'status' }))
    expect(world.tickets[0].portalStatusPublished).toBe('resolved')
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('stops after one query on an empty column', async () => {
    const { em, findCalls } = makeEm({ tasks: [], tickets: [], statuses: [] })
    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(0)
    expect(findCalls).toHaveLength(1)
  })
})
