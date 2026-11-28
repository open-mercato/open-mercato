/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { entityReferenceLockKey } from '@open-mercato/shared/lib/entities/reference-lock'

const mockResolveProjectAccess = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (em: { find: Function }, cls: unknown, where: unknown) => em.find(cls, where)),
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) =>
    em.findOne(cls, where),
  ),
}))

jest.mock('../../lib/time-tracking/access', () => {
  const actual = jest.requireActual('../../lib/time-tracking/access')
  return {
    ...actual,
    resolveProjectAccess: jest.fn((...args: unknown[]) => mockResolveProjectAccess(...args)),
  }
})

jest.mock('../../lib/staffMemberResolver', () => ({
  getStaffMemberByUserId: jest.fn((...args: unknown[]) => mockGetStaffMemberByUserId(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const STAFF_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const DEAL_ID = '99999999-9999-4999-8999-999999999999'
const LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

async function loadCommands() {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  const entities = await import('../../data/entities')
  return {
    create: commandRegistry.get('staff.timesheets.time_entries.create') as RegisteredCommand,
    update: commandRegistry.get('staff.timesheets.time_entries.update') as RegisteredCommand,
    StaffTimeEntry: entities.StaffTimeEntry as unknown,
  }
}

function makeEm(dealLive: boolean, StaffTimeEntry: unknown) {
  const order: string[] = []
  const entry: Record<string, unknown> = {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: new Date('2026-07-01T00:00:00.000Z'),
    durationMinutes: 60,
    roundedMinutes: 60,
    startedAt: null,
    endedAt: null,
    timeProjectId: null,
    taskId: null,
    dealId: null,
    lockedReportId: null,
    deletedAt: null,
  }
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    findOne: jest.fn(async (cls: unknown) => (cls === StaffTimeEntry ? entry : null)),
    find: jest.fn(async () => []),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => {
      order.push('create')
      return { ...data, id: ENTRY_ID }
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => { order.push('flush') }),
    begin: jest.fn(async () => { order.push('begin') }),
    commit: jest.fn(async () => { order.push('commit') }),
    rollback: jest.fn(async () => { order.push('rollback') }),
    execute: jest.fn(async (sql: string) => {
      if (sql === LOCK_SQL) {
        order.push('lock-deal')
        return []
      }
      order.push('check-deal')
      return dealLive ? [{ '?column?': 1 }] : []
    }),
  }
  em.fork.mockReturnValue(em)
  return { em, order, entry }
}

function makeCtx(em: unknown) {
  return {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        if (name === 'moduleConfigService') return { getRecord: async () => null }
        if (name === 'rbacService') {
          return { userHasAllFeatures: async () => true, getGrantedFeatures: async () => [] }
        }
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
  }
}

const expectedLockKey = entityReferenceLockKey({
  entityId: 'customers:customer_deal',
  recordId: DEAL_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
})

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: '2026-07-01',
    durationMinutes: 30,
    ...overrides,
  }
}

describe('staff time entry Deal reference lock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: STAFF_MEMBER_ID })
    mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  })

  it('locks the Deal and rechecks it is live inside the create transaction', async () => {
    const { create, StaffTimeEntry } = await loadCommands()
    const harness = makeEm(true, StaffTimeEntry)
    await create.execute(createInput({ dealId: DEAL_ID }), makeCtx(harness.em))
    expect(harness.em.execute).toHaveBeenNthCalledWith(1, LOCK_SQL, [expectedLockKey])
    expect(harness.em.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('from customer_deals'),
      [DEAL_ID, TENANT_ID, ORG_ID],
    )
    expect(harness.order).toEqual(['begin', 'lock-deal', 'check-deal', 'create', 'flush', 'commit'])
  })

  it('refuses to create an entry for a Deal a concurrent merge removed', async () => {
    const { create, StaffTimeEntry } = await loadCommands()
    const harness = makeEm(false, StaffTimeEntry)
    await expect(create.execute(createInput({ dealId: DEAL_ID }), makeCtx(harness.em)))
      .rejects.toMatchObject({ status: 404, body: { error: 'Deal not found.' } })
    expect(harness.em.create).not.toHaveBeenCalled()
    expect(harness.order).toContain('rollback')
    expect(harness.order).not.toContain('commit')
  })

  it('takes no Deal lock when the entry names no Deal', async () => {
    const { create, StaffTimeEntry } = await loadCommands()
    const harness = makeEm(true, StaffTimeEntry)
    await create.execute(createInput(), makeCtx(harness.em))
    expect(harness.em.execute).not.toHaveBeenCalled()
    expect(harness.em.begin).not.toHaveBeenCalled()
  })

  it('refuses to point an existing entry at a Deal that is gone', async () => {
    const { update, StaffTimeEntry } = await loadCommands()
    const harness = makeEm(false, StaffTimeEntry)
    await expect(update.execute({ id: ENTRY_ID, dealId: DEAL_ID }, makeCtx(harness.em)))
      .rejects.toMatchObject({ status: 404 })
    expect(harness.em.execute).toHaveBeenNthCalledWith(1, LOCK_SQL, [expectedLockKey])
    expect(harness.order).toContain('rollback')
    expect(harness.order).not.toContain('commit')
  })

  it('locks a live Deal before flushing an update that names it', async () => {
    const { update, StaffTimeEntry } = await loadCommands()
    const harness = makeEm(true, StaffTimeEntry)
    await update.execute({ id: ENTRY_ID, dealId: DEAL_ID }, makeCtx(harness.em))
    expect(harness.order.slice(-5)).toEqual(['begin', 'lock-deal', 'check-deal', 'flush', 'commit'])
    expect(harness.entry.dealId).toBe(DEAL_ID)
  })
})
