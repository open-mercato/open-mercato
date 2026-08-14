/** @jest-environment node */
// T4.10 — the grid bulk save and the clock-consistency rule T4.9 established for
// the single-entry path:
//
//   the clocks are the observation and the duration is their summary, so the
//   clocks win — unless the duration is the field the request actually pinned,
//   in which case the untouched clock moves to match it.
//
// A grid cell carries a duration and nothing else, so it is always the pinned
// field: `started_at` anchors and `ended_at` shifts. What this file exists to
// keep fixed is that the route wrote the duration onto the row WITHOUT touching
// its clocks, storing a two-hour duration against a 09:00–10:00 span — the
// defensible-invoice problem T4.9 removed one write path over, on the
// highest-volume path in the product.
//
// It also pins the two guard rails the reconciliation carries: a clock that does
// not exist is never manufactured (a cell whose entry has none keeps none; a
// running timer is not stopped), and `rounded_minutes` — the only input to cost
// under D-7 — is restated from whatever duration the reconciliation settles on.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const FOREIGN_ENTRY_ID = '55555555-5555-4555-8555-5555555555ff'
const LOCKED_ENTRY_ID = '66666666-6666-4666-8666-666666666666'
const CREATED_ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'

const DAY = '2026-08-03'
const AT = (clock: string, day: string = DAY) => new Date(`${day}T${clock}:00.000Z`)

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockRunStaffMutationGuards = jest.fn()
const mockRunStaffMutationGuardAfterSuccess = jest.fn()
const mockEntityManagerFind = jest.fn()
const mockTrxCreate = jest.fn()
const mockTrxFlush = jest.fn()

const settingsStore: Record<string, unknown> = {}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return { fork: () => forkedEntityManager }
    if (token === 'dataEngine') return { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn() }
    if (token === 'cache') return { get: jest.fn(), set: jest.fn(), deleteByTags: jest.fn() }
    if (token === 'moduleConfigService') {
      return {
        getRecord: async (_moduleId: string, name: string) =>
          Object.prototype.hasOwnProperty.call(settingsStore, name) ? { value: settingsStore[name] } : null,
      }
    }
    return undefined
  }),
}

const forkedEntityManager = {
  find: (...args: unknown[]) => mockEntityManagerFind(...args),
  transactional: async (callback: (trx: unknown) => unknown) =>
    callback({
      create: (...args: unknown[]) => mockTrxCreate(...args),
      flush: (...args: unknown[]) => mockTrxFlush(...args),
    }),
}

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string | null, fn: () => unknown) => fn()),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
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

jest.mock('../../../../guards', () => ({
  resolveUserFeatures: jest.fn(() => ['staff.timesheets.manage_own']),
  runStaffMutationGuards: jest.fn((...args: unknown[]) => mockRunStaffMutationGuards(...args)),
  runStaffMutationGuardAfterSuccess: jest.fn((...args: unknown[]) =>
    mockRunStaffMutationGuardAfterSuccess(...args),
  ),
}))

type StoredEntry = Record<string, unknown> & {
  id: string
  date: Date
  durationMinutes: number
  roundedMinutes: number | null
  startedAt: Date | null
  endedAt: Date | null
}

type LockedRow = {
  id: string
  lockedReportId: string
  date: Date
  timeProjectId: string
}

type FindWhere = Record<string, unknown>

let existingIdQueries: FindWhere[] = []
let loadQueries: FindWhere[] = []

const loadRoute = async () => {
  jest.resetModules()
  return import('../route')
}

function buildRequest(entries: Record<string, unknown>[]) {
  return new Request('http://localhost/api/staff/timesheets/time-entries/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
}

/** 09:00 → 10:00 on 2026-08-03, sixty raw minutes, sixty rounded. */
function storedEntry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: AT('00:00'),
    timeProjectId: PROJECT_ID,
    durationMinutes: 60,
    roundedMinutes: 60,
    startedAt: AT('09:00'),
    endedAt: AT('10:00'),
    notes: null,
    lockedReportId: null,
    deletedAt: null,
    ...overrides,
  }
}

/**
 * The route issues three `em.find` calls with distinct shapes — project
 * validation, the existing-id pre-check, and the lock pre-flight. Dispatching on
 * the `where` shape keeps the fake honest without depending on class identity
 * across `jest.resetModules()`.
 */
function wireEntityManagerFind(options: { existingIds?: string[]; locked?: LockedRow[] } = {}) {
  const existingIds = options.existingIds ?? []
  const locked = options.locked ?? []
  mockEntityManagerFind.mockImplementation(async (_cls: unknown, where: FindWhere) => {
    if (where.lockedReportId !== undefined) return locked
    if (where.staffMemberId !== undefined) {
      existingIdQueries.push(where)
      return existingIds.map((id) => ({ id }))
    }
    return [{ id: PROJECT_ID }, { id: OTHER_PROJECT_ID }]
  })
}

function wireStored(entries: StoredEntry[]) {
  wireEntityManagerFind({ existingIds: entries.map((entry) => entry.id) })
  mockFindWithDecryption.mockImplementation(async (_em: unknown, _cls: unknown, where: FindWhere) => {
    loadQueries.push(where)
    return entries
  })
}

async function saveCell(row: Record<string, unknown>): Promise<Response> {
  const { POST } = await loadRoute()
  return POST(buildRequest([{ date: DAY, timeProjectId: PROJECT_ID, ...row }]))
}

describe('POST /api/staff/timesheets/time-entries/bulk clock consistency (T4.10)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    existingIdQueries = []
    loadQueries = []
    for (const key of Object.keys(settingsStore)) delete settingsStore[key]
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      features: ['staff.timesheets.manage_own'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: TENANT_ID, selectedId: ORG_ID })
    mockFindOneWithDecryption.mockResolvedValue({ id: STAFF_MEMBER_ID })
    mockFindWithDecryption.mockResolvedValue([])
    mockRunStaffMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockTrxCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      id: CREATED_ENTRY_ID,
      ...data,
    }))
    mockTrxFlush.mockResolvedValue(undefined)
    wireEntityManagerFind()
  })

  describe('a duration edited in the grid', () => {
    it('moves the end to match instead of storing a duration that contradicts the span', async () => {
      const existing = storedEntry()
      wireStored([existing])

      const response = await saveCell({ id: ENTRY_ID, durationMinutes: 120 })

      expect(response.status).toBe(200)
      expect(existing.durationMinutes).toBe(120)
      expect(existing.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(existing.endedAt?.toISOString()).toBe(AT('11:00').toISOString())
    })

    it('carries the derived end over midnight rather than wrapping it onto the same day (D-8)', async () => {
      const existing = storedEntry({ startedAt: AT('23:00'), endedAt: AT('23:30'), durationMinutes: 30 })
      wireStored([existing])

      const response = await saveCell({ id: ENTRY_ID, durationMinutes: 120 })

      expect(response.status).toBe(200)
      expect(existing.endedAt?.toISOString()).toBe(AT('01:00', '2026-08-04').toISOString())
    })

    it('invents no clocks for a cell whose entry never had any', async () => {
      const existing = storedEntry({ startedAt: null, endedAt: null })
      wireStored([existing])

      const response = await saveCell({ id: ENTRY_ID, durationMinutes: 120 })

      expect(response.status).toBe(200)
      expect(existing.startedAt).toBeNull()
      expect(existing.endedAt).toBeNull()
      expect(existing.durationMinutes).toBe(120)
    })

    it('does not stop a running timer by manufacturing the end it is missing', async () => {
      const existing = storedEntry({ endedAt: null, durationMinutes: 0, roundedMinutes: 0 })
      wireStored([existing])

      const response = await saveCell({ id: ENTRY_ID, durationMinutes: 120 })

      expect(response.status).toBe(200)
      expect(existing.endedAt).toBeNull()
      expect(existing.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(existing.durationMinutes).toBe(120)
    })

    it('soft-deletes on a cleared cell without touching the clocks on the way out', async () => {
      const existing = storedEntry()
      wireStored([existing])

      const response = await saveCell({ id: ENTRY_ID, durationMinutes: 0 })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ deleted: 1 })
      expect(existing.deletedAt).toBeInstanceOf(Date)
      expect(existing.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(existing.endedAt?.toISOString()).toBe(AT('10:00').toISOString())
    })
  })

  describe('rounded minutes (D-7)', () => {
    it('rounds the duration the reconciliation settled on, beside the clocks it moved', async () => {
      settingsStore['rounding.unitMinutes'] = 15
      settingsStore['rounding.direction'] = 'up'
      const existing = storedEntry()
      wireStored([existing])
      const { roundMinutes } = await import('../../../../../lib/time-tracking/rounding')

      const response = await saveCell({ id: ENTRY_ID, durationMinutes: 61 })

      expect(response.status).toBe(200)
      expect(existing.durationMinutes).toBe(61)
      expect(existing.roundedMinutes).toBe(roundMinutes(61, { unitMinutes: 15, direction: 'up' }))
      expect(existing.roundedMinutes).toBe(75)
      expect(existing.endedAt?.toISOString()).toBe(AT('10:01').toISOString())
    })

    it('rounds a clockless row the same way', async () => {
      settingsStore['rounding.unitMinutes'] = 15
      settingsStore['rounding.direction'] = 'nearest'
      const existing = storedEntry({ startedAt: null, endedAt: null })
      wireStored([existing])

      const response = await saveCell({ id: ENTRY_ID, durationMinutes: 76 })

      expect(response.status).toBe(200)
      expect(existing.roundedMinutes).toBe(75)
    })
  })

  describe('a re-dated grid row', () => {
    it('takes its clocks to the new day rather than stranding them on the old one', async () => {
      const existing = storedEntry()
      wireStored([existing])
      const { POST } = await loadRoute()

      const response = await POST(
        buildRequest([{ id: ENTRY_ID, date: '2026-08-05', timeProjectId: PROJECT_ID, durationMinutes: 60 }]),
      )

      expect(response.status).toBe(200)
      expect(existing.startedAt?.toISOString()).toBe(AT('09:00', '2026-08-05').toISOString())
      expect(existing.endedAt?.toISOString()).toBe(AT('10:00', '2026-08-05').toISOString())
      expect(existing.durationMinutes).toBe(60)
    })

    it('keeps a midnight crossing crossing', async () => {
      const existing = storedEntry({
        startedAt: AT('23:00'),
        endedAt: AT('00:30', '2026-08-04'),
        durationMinutes: 90,
        roundedMinutes: 90,
      })
      wireStored([existing])
      const { POST } = await loadRoute()

      const response = await POST(
        buildRequest([{ id: ENTRY_ID, date: '2026-08-05', timeProjectId: PROJECT_ID, durationMinutes: 90 }]),
      )

      expect(response.status).toBe(200)
      expect(existing.startedAt?.toISOString()).toBe(AT('23:00', '2026-08-05').toISOString())
      expect(existing.endedAt?.toISOString()).toBe(AT('00:30', '2026-08-06').toISOString())
    })

    it('leaves a running timer where it is', async () => {
      const existing = storedEntry({ endedAt: null, durationMinutes: 0, roundedMinutes: 0 })
      wireStored([existing])
      const { POST } = await loadRoute()

      const response = await POST(
        buildRequest([{ id: ENTRY_ID, date: '2026-08-05', timeProjectId: PROJECT_ID, durationMinutes: 30 }]),
      )

      expect(response.status).toBe(200)
      expect(existing.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(existing.endedAt).toBeNull()
    })
  })

  describe('the lock gate still fires first (T4.2)', () => {
    it('refuses a locked entry named by id and reconciles nothing', async () => {
      const existing = storedEntry({ id: LOCKED_ENTRY_ID })
      wireStored([existing])
      wireEntityManagerFind({
        existingIds: [LOCKED_ENTRY_ID],
        locked: [{ id: LOCKED_ENTRY_ID, lockedReportId: REPORT_ID, date: AT('00:00'), timeProjectId: PROJECT_ID }],
      })

      const response = await saveCell({ id: LOCKED_ENTRY_ID, durationMinutes: 120 })

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        code: 'time_entry_locked',
        lockedEntryIds: [LOCKED_ENTRY_ID],
      })
      expect(existing.durationMinutes).toBe(60)
      expect(existing.endedAt?.toISOString()).toBe(AT('10:00').toISOString())
      expect(mockTrxFlush).not.toHaveBeenCalled()
    })

    it('refuses an id-less row landing on a (project, date) cell a locked entry occupies', async () => {
      wireEntityManagerFind({
        locked: [{ id: LOCKED_ENTRY_ID, lockedReportId: REPORT_ID, date: AT('00:00'), timeProjectId: PROJECT_ID }],
      })

      const response = await saveCell({ durationMinutes: 120 })

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        code: 'time_entry_locked',
        lockedEntryIds: [LOCKED_ENTRY_ID],
      })
      expect(mockTrxCreate).not.toHaveBeenCalled()
    })
  })

  describe('tenant isolation', () => {
    it('refuses an id that resolves in another tenant and reconciles nothing', async () => {
      const foreign = storedEntry({ id: FOREIGN_ENTRY_ID, tenantId: 'other-tenant' })
      // The pre-check runs tenant-, organization- and staff-member-scoped, so a
      // foreign row is simply not found — the reconciliation is never reached.
      wireEntityManagerFind({ existingIds: [] })
      mockFindWithDecryption.mockResolvedValue([foreign])

      const response = await saveCell({ id: FOREIGN_ENTRY_ID, durationMinutes: 120 })

      expect(response.status).toBe(422)
      expect(foreign.durationMinutes).toBe(60)
      expect(foreign.endedAt?.toISOString()).toBe(AT('10:00').toISOString())
      expect(mockTrxFlush).not.toHaveBeenCalled()
    })

    it('scopes both the id pre-check and the row load it reconciles from', async () => {
      const existing = storedEntry()
      wireStored([existing])

      await saveCell({ id: ENTRY_ID, durationMinutes: 120 })

      expect(existingIdQueries[0]).toMatchObject({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        staffMemberId: STAFF_MEMBER_ID,
        deletedAt: null,
      })
      expect(loadQueries[0]).toMatchObject({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        staffMemberId: STAFF_MEMBER_ID,
        deletedAt: null,
      })
    })
  })
})
