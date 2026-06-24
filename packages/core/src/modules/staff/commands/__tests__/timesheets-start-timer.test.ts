/** @jest-environment node */
// Regression coverage for issue #3311: starting a timesheet timer must be a
// single atomic command (create the timer entry AND start it in one
// transaction) so a partial failure can no longer leave an orphaned,
// never-started timer entry. The legacy flow issued two independent client
// requests (POST time-entries to create a `source:'timer'` row, then
// POST /timer-start); if the second request failed or the browser navigated
// between them, the created entry persisted unstarted. This test pins the
// atomic `staff.timesheets.time_entries.start_timer` command and proves that a
// rejected start (single-active-timer invariant, #2855) persists no orphan.
import type { AwilixContainer } from 'awilix'

const mockFindOneWithDecryption = jest.fn()
const mockEmitStaffEvent = jest.fn()

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
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn((...args: unknown[]) => mockEmitStaffEvent(...args)),
}))

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'

type LoadedCommand = {
  command: RegisteredCommand
  StaffTimeEntry: unknown
  StaffTimeEntrySegment: unknown
}

// Re-import the entity classes from the *same* freshly-reset module registry the
// command uses (jest.resetModules() makes a stale top-level import a different
// class object), so identity comparisons in the em.create mock line up.
async function loadStartTimerCommand(): Promise<LoadedCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  const entities = await import('../../data/entities')
  return {
    command: commandRegistry.get('staff.timesheets.time_entries.start_timer') as RegisteredCommand,
    StaffTimeEntry: entities.StaffTimeEntry,
    StaffTimeEntrySegment: entities.StaffTimeEntrySegment,
  }
}

type CreateCall = { cls: unknown; data: Record<string, unknown> }

function makeEm(createCalls: CreateCall[], StaffTimeEntry: unknown, StaffTimeEntrySegment: unknown) {
  let entrySeq = 0
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    // assertTimeProjectInScope() resolves the referenced project as in-scope.
    findOne: jest.fn(async () => ({ id: PROJECT_ID })),
    create: jest.fn((cls: unknown, data: Record<string, unknown>) => {
      createCalls.push({ cls, data })
      const created: Record<string, unknown> = { ...data }
      if (cls === StaffTimeEntry) created.id = `entry-${++entrySeq}`
      else if (cls === StaffTimeEntrySegment) created.id = 'segment-1'
      return created
    }),
    flush: jest.fn(async () => {}),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb(em)),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: unknown) {
  return {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
  }
}

function startInput() {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: '2026-01-01',
    timeProjectId: PROJECT_ID,
    notes: 'Working',
  }
}

describe('staff timesheets atomic start-timer (#3311)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockEmitStaffEvent.mockResolvedValue(undefined)
  })

  it('creates and starts the timer entry inside a single transaction', async () => {
    const { command, StaffTimeEntry, StaffTimeEntrySegment } = await loadStartTimerCommand()
    expect(command).toBeTruthy()
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls, StaffTimeEntry, StaffTimeEntrySegment)

    const result = (await command.execute(startInput(), createCtx(em))) as { timeEntryId: string }

    expect(result.timeEntryId).toBeTruthy()
    expect(em.transactional).toHaveBeenCalledTimes(1)

    const entryCreate = createCalls.find((call) => call.cls === StaffTimeEntry)
    const segmentCreate = createCalls.find((call) => call.cls === StaffTimeEntrySegment)
    expect(entryCreate?.data).toMatchObject({
      source: 'timer',
      durationMinutes: 0,
      staffMemberId: STAFF_MEMBER_ID,
      timeProjectId: PROJECT_ID,
    })
    expect(entryCreate?.data.startedAt).toBeInstanceOf(Date)
    expect(segmentCreate?.data).toMatchObject({
      segmentType: 'work',
      timeEntryId: result.timeEntryId,
    })
    expect(mockEmitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.time_entry.timer_started',
      expect.objectContaining({ id: result.timeEntryId, staffMemberId: STAFF_MEMBER_ID }),
      expect.objectContaining({ persistent: true }),
    )
  })

  it('rejects with 409 and persists no orphan entry when another timer is already running (#2855)', async () => {
    const { command, StaffTimeEntry, StaffTimeEntrySegment } = await loadStartTimerCommand()
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls, StaffTimeEntry, StaffTimeEntrySegment)
    // Single-active-timer invariant: the staff member already has a running entry.
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'other-running',
      staffMemberId: STAFF_MEMBER_ID,
      startedAt: new Date('2026-01-01T07:00:00.000Z'),
      endedAt: null,
    })

    await expect(command.execute(startInput(), createCtx(em))).rejects.toMatchObject({ status: 409 })

    // The invariant check runs before any create inside the same transaction, so
    // a rejected start leaves no orphaned entry or segment behind — the bug.
    expect(createCalls).toHaveLength(0)
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })
})
