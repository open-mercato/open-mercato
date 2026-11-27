// Unit tests for `ledger.createFiscalPeriod` (overlap rejection) and
// `ledger.lockFiscalPeriod` / `ledger.unlockFiscalPeriod`
// — scope per the Jira ticket: "konflikty optimistic lock przy lock/unlock
// okresu fiskalnego". Exercises the real
// `enforceCommandOptimisticLockWithGuards` -> `enforceCommandOptimisticLock`
// -> `assertOptimisticLock` chain (packages/shared/src/lib/crud/
// optimistic-lock-command.ts) through the command, not a reimplementation
// of the 409-conflict logic.
export {}

import { FiscalPeriod } from '../../data/entities'
import { buildFakeCtx, buildFakeEm, requestWithExpectedUpdatedAt } from './support/fakeEntityManager'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const PERIOD_ID = '77777777-7777-4777-8777-777777777777'
const CURRENT_UPDATED_AT = new Date('2026-02-01T10:00:00.000Z')

type FiscalPeriodDto = { id: string; isLocked: boolean; updatedAt: string }
type FiscalPeriodHandler = { execute: (input: unknown, ctx: unknown) => Promise<FiscalPeriodDto> }
type CreateFiscalPeriodHandler = { execute: (input: unknown, ctx: unknown) => Promise<{ fiscalPeriodId: string }> }

function loadCreateFiscalPeriodCommand(): CreateFiscalPeriodHandler {
  let create: unknown
  jest.isolateModules(() => {
    require('../fiscalPeriods')
    create = registerCommand.mock.calls.find(([candidate]) => candidate.id === 'ledger.createFiscalPeriod')?.[0]
  })
  if (!create) throw new Error('ledger.createFiscalPeriod was not registered')
  return create as CreateFiscalPeriodHandler
}

function loadFiscalPeriodCommands(): { lock: FiscalPeriodHandler; unlock: FiscalPeriodHandler } {
  let lock: unknown
  let unlock: unknown
  jest.isolateModules(() => {
    require('../fiscalPeriods')
    lock = registerCommand.mock.calls.find(([candidate]) => candidate.id === 'ledger.lockFiscalPeriod')?.[0]
    unlock = registerCommand.mock.calls.find(([candidate]) => candidate.id === 'ledger.unlockFiscalPeriod')?.[0]
  })
  if (!lock || !unlock) throw new Error('ledger.lockFiscalPeriod / ledger.unlockFiscalPeriod were not registered')
  return { lock: lock as FiscalPeriodHandler, unlock: unlock as FiscalPeriodHandler }
}

function seedPeriod(em: ReturnType<typeof buildFakeEm>, overrides: Partial<Record<string, unknown>> = {}) {
  return em.seed(FiscalPeriod, {
    id: PERIOD_ID,
    organizationId: ORG,
    tenantId: TENANT,
    startDate: new Date('2026-02-01'),
    endDate: new Date('2026-02-28'),
    isLocked: false,
    deletedAt: null,
    updatedAt: CURRENT_UPDATED_AT,
    ...overrides,
  })
}

describe('ledger.lockFiscalPeriod / ledger.unlockFiscalPeriod — optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('locks a period when no expected-updated-at header is supplied (opt-in guard, no-op without one)', async () => {
    const { lock } = loadFiscalPeriodCommands()
    const em = buildFakeEm()
    seedPeriod(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    const result = await lock.execute({ id: PERIOD_ID, organizationId: ORG, tenantId: TENANT }, ctx)

    expect(result.isLocked).toBe(true)
    expect(result.updatedAt).not.toBe(CURRENT_UPDATED_AT.toISOString())
  })

  it('rejects with a 409 optimistic-lock conflict when the expected-updated-at header does not match the current record', async () => {
    const { lock } = loadFiscalPeriodCommands()
    const em = buildFakeEm()
    seedPeriod(em)
    const staleExpected = '2026-01-01T00:00:00.000Z'
    const { ctx } = buildFakeCtx(em, {
      organizationId: ORG,
      tenantId: TENANT,
      request: requestWithExpectedUpdatedAt(staleExpected),
    })

    await expect(lock.execute({ id: PERIOD_ID, organizationId: ORG, tenantId: TENANT }, ctx)).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: CURRENT_UPDATED_AT.toISOString(),
        expectedUpdatedAt: staleExpected,
      },
    })
    // The conflict must be raised before any write — the period must stay unlocked.
    const stored = (em.tables.get('FiscalPeriod') ?? []).find((p) => p.id === PERIOD_ID)
    expect(stored?.isLocked).toBe(false)
  })

  it('succeeds when the expected-updated-at header matches the current record exactly', async () => {
    const { lock } = loadFiscalPeriodCommands()
    const em = buildFakeEm()
    seedPeriod(em)
    const { ctx } = buildFakeCtx(em, {
      organizationId: ORG,
      tenantId: TENANT,
      request: requestWithExpectedUpdatedAt(CURRENT_UPDATED_AT.toISOString()),
    })

    const result = await lock.execute({ id: PERIOD_ID, organizationId: ORG, tenantId: TENANT }, ctx)
    expect(result.isLocked).toBe(true)
  })

  it('unlockFiscalPeriod has the same optimistic-lock conflict behavior', async () => {
    const { unlock } = loadFiscalPeriodCommands()
    const em = buildFakeEm()
    seedPeriod(em, { isLocked: true })
    const staleExpected = '2020-01-01T00:00:00.000Z'
    const { ctx } = buildFakeCtx(em, {
      organizationId: ORG,
      tenantId: TENANT,
      request: requestWithExpectedUpdatedAt(staleExpected),
    })

    await expect(unlock.execute({ id: PERIOD_ID, organizationId: ORG, tenantId: TENANT }, ctx)).rejects.toMatchObject({
      status: 409,
      body: { code: 'optimistic_lock_conflict' },
    })
  })

  it('returns a plain 404 for a nonexistent period when no expected-updated-at header is supplied', async () => {
    const { lock } = loadFiscalPeriodCommands()
    const em = buildFakeEm()
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(
      lock.execute({ id: '00000000-0000-4000-8000-000000000000', organizationId: ORG, tenantId: TENANT }, ctx),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('surfaces a concurrent-delete race as a 409 conflict instead of a bare 404 when an expected-updated-at header was sent', async () => {
    const { lock } = loadFiscalPeriodCommands()
    const em = buildFakeEm()
    // No period seeded at all — simulates it having been deleted between
    // the client reading it and this lock request arriving.
    const { ctx } = buildFakeCtx(em, {
      organizationId: ORG,
      tenantId: TENANT,
      request: requestWithExpectedUpdatedAt(CURRENT_UPDATED_AT.toISOString()),
    })

    await expect(
      lock.execute({ id: PERIOD_ID, organizationId: ORG, tenantId: TENANT }, ctx),
    ).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
  })

  it('OSS-only when locking is disabled (OM_OPTIMISTIC_LOCK=off): a stale header does not 409', async () => {
    // Mirrors the save/restore pattern
    // `sales/commands/__tests__/optimistic-lock.test.ts` uses for the same
    // kill switch — this repo's own precedent for testing this env var.
    const previous = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = 'off'
    try {
      const { lock } = loadFiscalPeriodCommands()
      const em = buildFakeEm()
      seedPeriod(em)
      const { ctx } = buildFakeCtx(em, {
        organizationId: ORG,
        tenantId: TENANT,
        request: requestWithExpectedUpdatedAt('2020-01-01T00:00:00.000Z'), // deliberately stale
      })

      const result = await lock.execute({ id: PERIOD_ID, organizationId: ORG, tenantId: TENANT }, ctx)
      expect(result.isLocked).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previous
    }
  })
})

describe('ledger.createFiscalPeriod — overlap rejection', () => {
  const OTHER_ORG = '33333333-3333-4333-8333-333333333333'
  const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  function periodCount(em: ReturnType<typeof buildFakeEm>): number {
    return (em.tables.get('FiscalPeriod') ?? []).length
  }

  function input(startDate: string, endDate: string) {
    return { organizationId: ORG, tenantId: TENANT, startDate, endDate }
  }

  // The existing period is 2026-02-01..2026-02-28 (seedPeriod default).
  // Overlap is inclusive on both ends:
  //   existing.startDate <= new.endDate AND existing.endDate >= new.startDate
  it.each([
    ['identical range', '2026-02-01', '2026-02-28'],
    ['new range inside the existing one', '2026-02-10', '2026-02-12'],
    ['new range encloses the existing one', '2026-01-01', '2026-03-31'],
    ['new range overlaps the existing start', '2026-01-15', '2026-02-01'],
    ['new range overlaps the existing end', '2026-02-28', '2026-03-31'],
    ['single-day range on the existing start boundary', '2026-02-01', '2026-02-01'],
    ['single-day range on the existing end boundary', '2026-02-28', '2026-02-28'],
  ])('rejects with 409 when the range overlaps an existing period: %s', async (_label, start, end) => {
    const create = loadCreateFiscalPeriodCommand()
    const em = buildFakeEm()
    seedPeriod(em)
    const { ctx, dataEngine } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(create.execute(input(start, end), ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: expect.stringContaining('overlaps an existing fiscal period') },
    })
    // Rejected before any write: no second row, no side effect emitted.
    expect(periodCount(em)).toBe(1)
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
    expect(dataEngine.emitEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['the day after the existing end', '2026-03-01', '2026-03-31'],
    ['the day before the existing start', '2026-01-01', '2026-01-31'],
  ])('creates the period when the range is adjacent but does not overlap: %s', async (_label, start, end) => {
    const create = loadCreateFiscalPeriodCommand()
    const em = buildFakeEm()
    seedPeriod(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    const result = await create.execute(input(start, end), ctx)

    expect(typeof result.fiscalPeriodId).toBe('string')
    expect(periodCount(em)).toBe(2)
  })

  it('ignores a soft-deleted period when checking for overlap', async () => {
    const create = loadCreateFiscalPeriodCommand()
    const em = buildFakeEm()
    seedPeriod(em, { deletedAt: new Date('2026-02-15T00:00:00.000Z') })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(create.execute(input('2026-02-01', '2026-02-28'), ctx)).resolves.toMatchObject({
      fiscalPeriodId: expect.any(String),
    })
    expect(periodCount(em)).toBe(2)
  })

  it('ignores an overlapping period that belongs to another organization or tenant', async () => {
    const create = loadCreateFiscalPeriodCommand()
    const em = buildFakeEm()
    seedPeriod(em, { id: '88888888-8888-4888-8888-888888888888', organizationId: OTHER_ORG })
    seedPeriod(em, { id: '99999999-9999-4999-8999-999999999999', tenantId: OTHER_TENANT })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(create.execute(input('2026-02-01', '2026-02-28'), ctx)).resolves.toMatchObject({
      fiscalPeriodId: expect.any(String),
    })
    expect(periodCount(em)).toBe(3)
  })

  it('takes the per-scope advisory lock before it reads for an overlap', async () => {
    const create = loadCreateFiscalPeriodCommand()
    const em = buildFakeEm()
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await create.execute(input('2026-04-01', '2026-04-30'), ctx)

    const lockCallIndex = em.execute.mock.calls.findIndex(([sql]) => String(sql).includes('pg_advisory_xact_lock'))
    expect(lockCallIndex).toBeGreaterThanOrEqual(0)
    expect(em.execute.mock.calls[lockCallIndex][1]).toEqual([`ledger.fiscal_period:${ORG}:${TENANT}`])
    // Lock first, overlap read second: the order is what serializes concurrent creates.
    const lockOrder = em.execute.mock.invocationCallOrder[lockCallIndex]
    const firstReadOrder = Math.min(...em.findOne.mock.invocationCallOrder)
    expect(lockOrder).toBeLessThan(firstReadOrder)
  })
})
