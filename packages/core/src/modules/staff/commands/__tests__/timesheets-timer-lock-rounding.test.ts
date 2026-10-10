/** @jest-environment node */
// T4.2 — the timer transitions, which are the two write paths that touch an
// entry's duration without going through the entries command.
//
//  * Lock gate (risk R3): starting a timer on a frozen entry is the first half of
//    changing its duration, and stopping one rewrites `duration_minutes`
//    outright, so both are refused with the same `409 time_entry_locked`.
//  * Rounding (D-7): timer-stop writes a duration outside the entries command, and
//    `rounded_minutes` is the ONLY input to cost — a stale value left over from
//    the zero-minute row the timer was created with would bill nothing.
//
// Both behaviours used to live in the `timer-start` / `timer-stop` routes and were
// pinned there. Those routes now delegate to the command bus (#2609), so the guards
// moved into the commands and this test drives the commands directly.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const SEGMENT_ID = '44444444-4444-4444-8444-444444444444'
const STAFF_MEMBER_ID = '55555555-5555-4555-8555-555555555555'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'

const START_COMMAND_ID = 'staff.timesheets.time_entries.start_timer_existing'
const STOP_COMMAND_ID = 'staff.timesheets.time_entries.stop_timer'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()
const mockEmitStaffEvent = jest.fn()

const settingsStore: Record<string, unknown> = {}

const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ id: 'segment-created', ...data })),
  flush: jest.fn(async () => {}),
  transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(mockEm)),
}

const container = {
  resolve: (token: string) => {
    if (token === 'em') return mockEm
    if (token === 'dataEngine') return {}
    if (token === 'moduleConfigService') {
      return {
        getRecord: async (_moduleId: string, name: string) =>
          Object.prototype.hasOwnProperty.call(settingsStore, name) ? { value: settingsStore[name] } : null,
      }
    }
    return null
  },
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/lib/staffMemberResolver', () => ({
  getStaffMemberByUserId: jest.fn((...args: unknown[]) => mockGetStaffMemberByUserId(...args)),
}))

jest.mock('../../events', () => ({
  emitStaffEvent: (...args: unknown[]) => mockEmitStaffEvent(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => undefined),
    emitCrudUndoSideEffects: jest.fn(async () => undefined),
  }
})

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

async function loadCommand(commandId: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  return commandRegistry.get(commandId) as RegisteredCommand
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    startedAt: null,
    endedAt: null,
    durationMinutes: 0,
    roundedMinutes: 0,
    lockedReportId: null,
    source: 'manual',
    ...overrides,
  }
}

function commandContext() {
  return {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

function commandInput() {
  return { id: ENTRY_ID, tenantId: TENANT_ID, organizationId: ORG_ID }
}

async function statusOf(run: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await run
    return { status: 200, body: {} }
  } catch (err) {
    const error = err as { status?: number; body?: Record<string, unknown> }
    return { status: error.status ?? 500, body: error.body ?? {} }
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(settingsStore)) delete settingsStore[key]
  mockEm.fork.mockReturnValue(mockEm)
  mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  mockEmitStaffEvent.mockResolvedValue(undefined)
  mockFindWithDecryption.mockResolvedValue([])
})

describe('start_timer_existing lock gate (T4.2 / TC-TT-018)', () => {
  it('refuses to start a timer on an entry frozen in a closed report', async () => {
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where) => {
      // The single-active-timer probe matches on `id: { $ne }`, not a bare id.
      if (typeof (where as Record<string, unknown>).id === 'object') return null
      return makeEntry({ lockedReportId: REPORT_ID })
    })

    const command = await loadCommand(START_COMMAND_ID)
    const { status, body } = await statusOf(command.execute(commandInput(), commandContext()))

    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'time_entry_locked', lockedReportId: REPORT_ID })
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('still starts a timer on an unlocked entry', async () => {
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where) => {
      if (typeof (where as Record<string, unknown>).id === 'object') return null
      return makeEntry()
    })

    const command = await loadCommand(START_COMMAND_ID)
    const { status } = await statusOf(command.execute(commandInput(), commandContext()))

    expect(status).toBe(200)
    expect(mockEm.create).toHaveBeenCalled()
  })
})

describe('stop_timer lock gate and rounding (T4.2)', () => {
  function wireRunningEntry(overrides: Record<string, unknown> = {}, minutes = 61) {
    const entry = makeEntry({
      startedAt: new Date('2026-01-01T08:00:00.000Z'),
      ...overrides,
    })
    mockFindOneWithDecryption.mockImplementation(async () => entry)
    mockFindWithDecryption.mockResolvedValue([
      {
        id: SEGMENT_ID,
        segmentType: 'work',
        startedAt: new Date('2026-01-01T08:00:00.000Z'),
        endedAt: null,
      },
    ])
    // Freeze "now" so the recomputed duration is deterministic.
    jest.useFakeTimers().setSystemTime(new Date(new Date('2026-01-01T08:00:00.000Z').getTime() + minutes * 60000))
    return entry
  }

  afterEach(() => {
    jest.useRealTimers()
  })

  it('refuses to stop a timer on an entry frozen in a closed report', async () => {
    wireRunningEntry({ lockedReportId: REPORT_ID })

    const command = await loadCommand(STOP_COMMAND_ID)
    const { status, body } = await statusOf(command.execute(commandInput(), commandContext()))

    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'time_entry_locked', lockedReportId: REPORT_ID })
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('writes rounded_minutes beside the recomputed duration using the tenant rule (D-7)', async () => {
    settingsStore['rounding.unitMinutes'] = 15
    settingsStore['rounding.direction'] = 'up'
    const entry = wireRunningEntry({}, 61)
    const { roundMinutes } = await import('../../lib/time-tracking/rounding')

    const command = await loadCommand(STOP_COMMAND_ID)
    const { status } = await statusOf(command.execute(commandInput(), commandContext()))

    expect(status).toBe(200)
    expect(entry.durationMinutes).toBe(61)
    expect(entry.roundedMinutes).toBe(75)
    expect(entry.roundedMinutes).toBe(roundMinutes(61, { unitMinutes: 15, direction: 'up' }))
  })

  it("never leaves the rounded value stale at the timer entry's zero-minute seed", async () => {
    const entry = wireRunningEntry({ roundedMinutes: 0 }, 61)

    const command = await loadCommand(STOP_COMMAND_ID)
    const { status } = await statusOf(command.execute(commandInput(), commandContext()))

    expect(status).toBe(200)
    expect(entry.roundedMinutes).toBe(61)
  })
})
