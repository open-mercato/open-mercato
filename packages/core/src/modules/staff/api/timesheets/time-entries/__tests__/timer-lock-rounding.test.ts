/** @jest-environment node */
// T4.2 — the timer routes, which are the two write paths that touch an entry's
// duration without going through the entries command.
//
//  * Lock gate (risk R3): starting a timer on a frozen entry is the first half of
//    changing its duration, and stopping one rewrites `duration_minutes`
//    outright, so both are refused with the same `409 time_entry_locked`.
//  * Rounding (D-7): timer-stop writes a duration outside the command, and
//    `rounded_minutes` is the ONLY input to cost — a stale value left over from
//    the zero-minute row the timer was created with would bill nothing.

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const SEGMENT_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()
const mockEmitStaffEvent = jest.fn()

const settingsStore: Record<string, unknown> = {}

const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ id: 'segment-created', ...data })),
  flush: jest.fn(async () => {}),
  transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(mockEm)),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'moduleConfigService') {
        return {
          getRecord: async (_moduleId: string, name: string) =>
            Object.prototype.hasOwnProperty.call(settingsStore, name) ? { value: settingsStore[name] } : null,
        }
      }
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID, roles: ['admin'] })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId: TENANT_ID,
    selectedId: ORG_ID,
    filterIds: [ORG_ID],
  })),
}))

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

jest.mock('@open-mercato/core/modules/staff/api/guards', () => ({
  ...jest.requireActual('@open-mercato/core/modules/staff/api/guards'),
  resolveUserFeatures: jest.fn(() => ['staff.timesheets.manage_own']),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) =>
    mockRunStaffMutationGuardAfterSuccess(...args),
  ),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn((...args: unknown[]) => mockEmitStaffEvent(...args)),
}))

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

function timerStartRequest() {
  return new Request(`http://localhost/api/staff/timesheets/time-entries/${ENTRY_ID}/timer-start`, { method: 'POST' })
}

function timerStopRequest() {
  return new Request(`http://localhost/api/staff/timesheets/time-entries/${ENTRY_ID}/timer-stop`, { method: 'POST' })
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(settingsStore)) delete settingsStore[key]
  mockEm.fork.mockReturnValue(mockEm)
  mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  mockRunStaffMutationGuardAfterSuccess.mockResolvedValue(undefined)
  mockEmitStaffEvent.mockResolvedValue(undefined)
  mockFindWithDecryption.mockResolvedValue([])
})

describe('timer-start lock gate (T4.2 / TC-TT-018)', () => {
  it('refuses to start a timer on an entry frozen in a closed report', async () => {
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where) => {
      if ((where as Record<string, unknown>).id && typeof (where as Record<string, unknown>).id === 'object') return null
      return makeEntry({ lockedReportId: REPORT_ID })
    })

    const { POST } = await import('../[id]/timer-start/route')
    const res = await POST(timerStartRequest())

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'time_entry_locked', lockedReportId: REPORT_ID })
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('still starts a timer on an unlocked entry', async () => {
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where) => {
      if ((where as Record<string, unknown>).id && typeof (where as Record<string, unknown>).id === 'object') return null
      return makeEntry()
    })

    const { POST } = await import('../[id]/timer-start/route')
    const res = await POST(timerStartRequest())

    expect(res.status).toBe(200)
  })
})

describe('timer-stop lock gate and rounding (T4.2)', () => {
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

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(timerStopRequest())

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'time_entry_locked', lockedReportId: REPORT_ID })
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('writes rounded_minutes beside the recomputed duration using the tenant rule (D-7)', async () => {
    settingsStore['rounding.unitMinutes'] = 15
    settingsStore['rounding.direction'] = 'up'
    const entry = wireRunningEntry({}, 61)
    const { roundMinutes } = await import('../../../../lib/time-tracking/rounding')

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(timerStopRequest())

    expect(res.status).toBe(200)
    expect(entry.durationMinutes).toBe(61)
    expect(entry.roundedMinutes).toBe(75)
    expect(entry.roundedMinutes).toBe(roundMinutes(61, { unitMinutes: 15, direction: 'up' }))
  })

  it('never leaves the rounded value stale at the timer entry\'s zero-minute seed', async () => {
    const entry = wireRunningEntry({ roundedMinutes: 0 }, 61)

    const { POST } = await import('../[id]/timer-stop/route')
    const res = await POST(timerStopRequest())

    expect(res.status).toBe(200)
    expect(entry.roundedMinutes).toBe(61)
  })
})
