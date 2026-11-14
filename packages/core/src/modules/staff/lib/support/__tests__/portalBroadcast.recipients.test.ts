/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const mockEmitStaffEvent = jest.fn()
const mockReportError = jest.fn()

jest.mock('../../../events', () => ({
  emitStaffEvent: (...args: unknown[]) => mockEmitStaffEvent(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) => em.findOne(cls, where)),
}))

import { fanOutStatusColumn } from '../portalBroadcast'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const VIEW_FEATURE = 'portal.support_tickets.view'

type AclRow = { user_id: string; features_json: unknown; is_portal_admin: boolean }

type PortalTables = {
  customerUsers: { id: string }[]
  roleAcls: AclRow[]
  failOnce: { table: string; error: Error } | null
}

function makeWorld(tables: PortalTables) {
  const task = {
    id: 't1',
    taskStatusId: 'done',
    customerId: 'customer-1',
    source: 'portal',
    timeProjectId: 'project-1',
    ...SCOPE,
    deletedAt: null,
    updatedAt: new Date('2026-10-14T10:00:00.000Z'),
  }
  const ticket = { taskId: 't1', supportReference: 'SUP-1', portalStatusPublished: 'in_progress' as string | null, updatedAt: new Date(0) }
  const flush = jest.fn(async () => undefined)
  const selectFrom = (table: string) => {
    const builder = {
      select: () => builder,
      where: () => builder,
      innerJoin: () => builder,
      limit: () => builder,
      execute: async () => {
        if (tables.failOnce && tables.failOnce.table === table) {
          const { error } = tables.failOnce
          tables.failOnce = null
          throw error
        }
        if (table === 'customer_users') return tables.customerUsers
        if (table === 'customer_user_roles') return tables.roleAcls
        return []
      },
    }
    return builder
  }
  const em: Record<string, unknown> = {
    flush,
    getKysely: () => ({ selectFrom }),
    findOne: jest.fn(async (cls: { name: string }) => {
      if (cls.name === 'StaffTimeTask') return task
      if (cls.name === 'StaffSupportTicket') return ticket
      if (cls.name === 'StaffTimeTaskStatus') return { id: 'done', isDefault: false, isDone: true }
      return null
    }),
    find: jest.fn(async (_cls: unknown, _where: unknown, options: { offset: number }) => (options.offset === 0 ? [{ id: 't1' }] : [])),
  }
  em.fork = jest.fn(() => em)
  return { em: em as unknown as EntityManager, ticket, flush }
}

function portalUpdates() {
  return mockEmitStaffEvent.mock.calls.filter(([eventId]) => eventId === 'staff.support_ticket.portal_updated')
}

function grantedTables(): PortalTables {
  return {
    customerUsers: [{ id: 'portal-user-1' }],
    roleAcls: [{ user_id: 'portal-user-1', features_json: [VIEW_FEATURE], is_portal_admin: false }],
    failOnce: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmitStaffEvent.mockResolvedValue(undefined)
})

describe('fanOutStatusColumn against the real portal recipient helpers', () => {
  it.each([
    ['the customer user lookup', 'customer_users'],
    ['the per-user ACL lookup', 'customer_user_acls'],
    ['the role ACL lookup', 'customer_user_roles'],
  ])('keeps the marker and throws when %s fails, then the retry delivers', async (_label, failingTable) => {
    const tables = grantedTables()
    tables.failOnce = { table: failingTable, error: new Error('[internal] connection terminated unexpectedly') }
    const { em, ticket, flush } = makeWorld(tables)

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).rejects.toThrow('connection terminated unexpectedly')

    expect(ticket.portalStatusPublished).toBe('in_progress')
    expect(flush).not.toHaveBeenCalled()
    expect(portalUpdates()).toHaveLength(0)

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(1)

    expect(portalUpdates()).toHaveLength(1)
    expect(portalUpdates()[0][1]).toEqual(expect.objectContaining({ portalStatus: 'resolved', kind: 'status', recipientUserIds: ['portal-user-1'] }))
    expect(ticket.portalStatusPublished).toBe('resolved')
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('advances the marker once and settles when nobody holds the portal view feature', async () => {
    const tables = grantedTables()
    tables.roleAcls = [{ user_id: 'portal-user-1', features_json: ['portal.time_reports.view'], is_portal_admin: false }]
    const { em, ticket, flush } = makeWorld(tables)

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(1)

    expect(portalUpdates()).toHaveLength(0)
    expect(ticket.portalStatusPublished).toBe('resolved')
    expect(flush).toHaveBeenCalledTimes(1)

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(0)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(portalUpdates()).toHaveLength(0)
  })

  it('advances the marker when the customer has no portal users', async () => {
    const { em, ticket } = makeWorld({ customerUsers: [], roleAcls: [], failOnce: null })

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(1)

    expect(portalUpdates()).toHaveLength(0)
    expect(ticket.portalStatusPublished).toBe('resolved')
  })

  it('treats an absent customer_accounts module as an empty audience, not a failure', async () => {
    const missingTable = Object.assign(new Error('relation "customer_users" does not exist'), { code: '42P01' })
    const { em, ticket } = makeWorld({ customerUsers: [], roleAcls: [], failOnce: { table: 'customer_users', error: missingTable } })

    await expect(fanOutStatusColumn(em, 'done', SCOPE)).resolves.toBe(1)

    expect(portalUpdates()).toHaveLength(0)
    expect(ticket.portalStatusPublished).toBe('resolved')
    expect(mockReportError).not.toHaveBeenCalled()
  })
})
