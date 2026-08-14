/** @jest-environment node */
// The grid bulk save and the five fields its schema has always accepted but the
// handler never read: `taskId`, `description`, `isBillable`, `tagIds` and
// `rateOverrideAmount`.
//
// The defect this file pins closed is the silent no-op: a caller sent `taskId`,
// got `200 OK` and a task-less entry — hours filed against a project whose board
// never shows the task, with nothing in the response to say so. What replaces it
// is not a second interpretation of those fields but the SAME one the
// single-entry command applies, reached through the same exported helpers: the
// project follows from the task, the billable default falls project-then-tenant,
// the project currency is snapshotted at write time (D-3), `description` beats
// `notes`, and a rate override is stored as the decimal string the column holds.
//
// `tagIds` is the one field bulk refuses rather than honours — see the tag block
// below for why a 422 is the honest answer and a post-commit dispatch is not.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const TASK_ID = '88888888-8888-4888-8888-888888888888'
const OTHER_PROJECT_TASK_ID = '88888888-8888-4888-8888-8888888888ff'
const FOREIGN_TASK_ID = '88888888-8888-4888-8888-8888888888aa'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const LOCKED_ENTRY_ID = '66666666-6666-4666-8666-666666666666'
const CREATED_ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'
const TAG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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

const forkedEntityManager = {
  find: (...args: unknown[]) => mockEntityManagerFind(...args),
  transactional: async (callback: (trx: unknown) => unknown) =>
    callback({
      create: (...args: unknown[]) => mockTrxCreate(...args),
      flush: (...args: unknown[]) => mockTrxFlush(...args),
    }),
}

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

type FindWhere = Record<string, unknown>
type FindOptions = { fields?: string[] } | undefined

type ProjectRow = { id: string; currencyCode: string | null; billableByDefault: boolean | null }
type TaskRow = { id: string; timeProjectId: string }
type LockedRow = { id: string; lockedReportId: string; date: Date; timeProjectId: string }

type StoredEntry = Record<string, unknown> & {
  id: string
  date: Date
  timeProjectId: string | null
  durationMinutes: number
}

let taskQueries: FindWhere[] = []

const PROJECTS: ProjectRow[] = [
  { id: PROJECT_ID, currencyCode: 'PLN', billableByDefault: true },
  { id: OTHER_PROJECT_ID, currencyCode: 'EUR', billableByDefault: false },
]

const TASKS: TaskRow[] = [
  { id: TASK_ID, timeProjectId: PROJECT_ID },
  { id: OTHER_PROJECT_TASK_ID, timeProjectId: OTHER_PROJECT_ID },
]

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

/**
 * The route issues four `em.find` calls, and the task and project lookups share
 * a `where` shape — they are told apart by the projection each one asks for,
 * which is also the thing that would break first if either query lost a column
 * the write path reads.
 */
function wireEntityManagerFind(
  options: { existingIds?: string[]; locked?: LockedRow[]; projects?: ProjectRow[]; tasks?: TaskRow[] } = {},
) {
  const existingIds = options.existingIds ?? []
  const locked = options.locked ?? []
  const projects = options.projects ?? PROJECTS
  const tasks = options.tasks ?? TASKS
  mockEntityManagerFind.mockImplementation(async (_cls: unknown, where: FindWhere, opts: FindOptions) => {
    if (where.lockedReportId !== undefined) return locked
    if (where.staffMemberId !== undefined) return existingIds.map((id) => ({ id }))
    if (opts?.fields?.includes('timeProjectId')) {
      taskQueries.push(where)
      const requested = ((where.id as { $in?: string[] })?.$in ?? []) as string[]
      return tasks.filter((task) => requested.includes(task.id))
    }
    const requestedProjects = ((where.id as { $in?: string[] })?.$in ?? []) as string[]
    return projects.filter((project) => requestedProjects.includes(project.id))
  })
}

function storedEntry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: AT('00:00'),
    timeProjectId: PROJECT_ID,
    taskId: null,
    durationMinutes: 60,
    roundedMinutes: 60,
    startedAt: AT('09:00'),
    endedAt: AT('10:00'),
    notes: null,
    isBillable: true,
    rateOverrideAmount: null,
    rateCurrencyCode: 'PLN',
    lockedReportId: null,
    deletedAt: null,
    ...overrides,
  }
}

function wireStored(entries: StoredEntry[], options: { locked?: LockedRow[] } = {}) {
  wireEntityManagerFind({ existingIds: entries.map((entry) => entry.id), locked: options.locked })
  mockFindWithDecryption.mockImplementation(async () => entries)
}

async function post(rows: Record<string, unknown>[]): Promise<Response> {
  const { POST } = await loadRoute()
  return POST(buildRequest(rows))
}

/** The row a created entry was built from, as `trx.create` received it. */
function createdRow(): Record<string, unknown> {
  expect(mockTrxCreate).toHaveBeenCalledTimes(1)
  return mockTrxCreate.mock.calls[0][1] as Record<string, unknown>
}

describe('POST /api/staff/timesheets/time-entries/bulk honours every field its schema accepts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    taskQueries = []
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

  describe('taskId on a created row', () => {
    it('persists the task instead of reporting success and dropping it', async () => {
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, taskId: TASK_ID, durationMinutes: 60 },
      ])

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ ok: true, created: 1 })
      expect(createdRow()).toMatchObject({ taskId: TASK_ID, timeProjectId: PROJECT_ID })
    })

    it('inherits the project from the task when the row names only a task', async () => {
      const response = await post([{ date: DAY, taskId: TASK_ID, durationMinutes: 60 }])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ taskId: TASK_ID, timeProjectId: PROJECT_ID })
    })

    it('refuses a task belonging to another project rather than filing the hours under it', async () => {
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, taskId: OTHER_PROJECT_TASK_ID, durationMinutes: 60 },
      ])

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        errors: [{ path: 'entries[].taskId', value: OTHER_PROJECT_TASK_ID }],
      })
      expect(mockTrxCreate).not.toHaveBeenCalled()
    })

    it('refuses a row naming neither a project nor a task', async () => {
      const response = await post([{ date: DAY, durationMinutes: 60 }])

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        errors: [{ path: 'entries[].timeProjectId' }],
      })
      expect(mockTrxCreate).not.toHaveBeenCalled()
    })
  })

  describe('the billable default chain', () => {
    it('takes the value the row states', async () => {
      settingsStore['defaults.billable'] = true
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 60, isBillable: false },
      ])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ isBillable: false })
    })

    it("falls to the project's own default before the tenant's", async () => {
      settingsStore['defaults.billable'] = true
      const response = await post([{ date: DAY, timeProjectId: OTHER_PROJECT_ID, durationMinutes: 60 }])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ isBillable: false })
    })

    it('falls to the tenant setting when the project states no default', async () => {
      settingsStore['defaults.billable'] = false
      wireEntityManagerFind({
        projects: [{ id: PROJECT_ID, currencyCode: 'PLN', billableByDefault: null }],
      })

      const response = await post([{ date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 60 }])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ isBillable: false })
    })
  })

  describe('money on a created row', () => {
    it('stores the rate override as the decimal string the column holds', async () => {
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 60, rateOverrideAmount: 123.5 },
      ])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ rateOverrideAmount: '123.5' })
    })

    it("snapshots the project's currency rather than leaving it to be joined later (D-3)", async () => {
      const response = await post([{ date: DAY, timeProjectId: OTHER_PROJECT_ID, durationMinutes: 60 }])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ rateCurrencyCode: 'EUR' })
    })
  })

  describe('description and notes', () => {
    it('lets description win when a row carries both', async () => {
      const response = await post([
        {
          date: DAY,
          timeProjectId: PROJECT_ID,
          durationMinutes: 60,
          notes: 'from notes',
          description: 'from description',
        },
      ])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ notes: 'from description' })
    })

    it('still accepts notes on its own', async () => {
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 60, notes: 'from notes' },
      ])

      expect(response.status).toBe(200)
      expect(createdRow()).toMatchObject({ notes: 'from notes' })
    })
  })

  describe('the same fields on an updated row', () => {
    it('writes the task, the billable flag, the override and the description', async () => {
      const existing = storedEntry()
      wireStored([existing])

      const response = await post([
        {
          id: ENTRY_ID,
          date: DAY,
          timeProjectId: PROJECT_ID,
          durationMinutes: 90,
          taskId: TASK_ID,
          isBillable: false,
          rateOverrideAmount: 55,
          notes: 'from notes',
          description: 'from description',
        },
      ])

      expect(response.status).toBe(200)
      expect(existing.taskId).toBe(TASK_ID)
      expect(existing.isBillable).toBe(false)
      expect(existing.rateOverrideAmount).toBe('55')
      expect(existing.notes).toBe('from description')
    })

    it('leaves fields the row does not mention exactly as they were stored', async () => {
      const existing = storedEntry({
        taskId: TASK_ID,
        isBillable: false,
        rateOverrideAmount: '42',
        notes: 'kept',
      })
      wireStored([existing])

      const response = await post([
        { id: ENTRY_ID, date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 90 },
      ])

      expect(response.status).toBe(200)
      expect(existing.taskId).toBe(TASK_ID)
      expect(existing.isBillable).toBe(false)
      expect(existing.rateOverrideAmount).toBe('42')
      expect(existing.notes).toBe('kept')
    })

    it('restates the currency snapshot only when the entry moves to another project', async () => {
      const stayed = storedEntry({ rateCurrencyCode: 'USD' })
      wireStored([stayed])
      await post([{ id: ENTRY_ID, date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 90 }])
      expect(stayed.rateCurrencyCode).toBe('USD')

      const moved = storedEntry({ rateCurrencyCode: 'USD' })
      wireStored([moved])
      await post([{ id: ENTRY_ID, date: DAY, timeProjectId: OTHER_PROJECT_ID, durationMinutes: 90 }])
      expect(moved.rateCurrencyCode).toBe('EUR')
    })

    it('reconciles the interval exactly as before while writing the new fields (T4.10)', async () => {
      const existing = storedEntry()
      wireStored([existing])

      const response = await post([
        { id: ENTRY_ID, date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 120, taskId: TASK_ID },
      ])

      expect(response.status).toBe(200)
      expect(existing.taskId).toBe(TASK_ID)
      expect(existing.durationMinutes).toBe(120)
      expect((existing.startedAt as Date).toISOString()).toBe(AT('09:00').toISOString())
      expect((existing.endedAt as Date).toISOString()).toBe(AT('11:00').toISOString())
    })
  })

  describe('tagIds', () => {
    // Honouring tags would mean dispatching the tag commands, which fork their
    // own EntityManager: inside the route's transaction they cannot see the rows
    // it has not committed, and after the commit a failure would be invisible in
    // a response that carries only counts — the silent success this whole change
    // exists to remove. So the row is refused, loudly, and the user is sent to
    // the entry dialog where tags keep their audit trail, undo and lock check.
    it('refuses a row carrying tagIds instead of accepting and dropping them', async () => {
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 60, tagIds: [TAG_ID] },
      ])

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        errors: [{ path: 'entries[].tagIds' }],
      })
      expect(mockTrxCreate).not.toHaveBeenCalled()
      expect(mockTrxFlush).not.toHaveBeenCalled()
    })

    it('refuses an empty tag list too, because clearing tags is a change as much as setting them', async () => {
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, durationMinutes: 60, tagIds: [] },
      ])

      expect(response.status).toBe(422)
      expect(mockTrxCreate).not.toHaveBeenCalled()
    })
  })

  describe('the lock gate still fires first on both shapes (T4.2)', () => {
    it('refuses a locked entry named by id before any field is written', async () => {
      const existing = storedEntry({ id: LOCKED_ENTRY_ID })
      wireStored([existing], {
        locked: [{ id: LOCKED_ENTRY_ID, lockedReportId: REPORT_ID, date: AT('00:00'), timeProjectId: PROJECT_ID }],
      })

      const response = await post([
        {
          id: LOCKED_ENTRY_ID,
          date: DAY,
          timeProjectId: PROJECT_ID,
          durationMinutes: 120,
          taskId: TASK_ID,
          isBillable: false,
        },
      ])

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        code: 'time_entry_locked',
        lockedEntryIds: [LOCKED_ENTRY_ID],
      })
      expect(existing.taskId).toBeNull()
      expect(existing.isBillable).toBe(true)
      expect(mockTrxFlush).not.toHaveBeenCalled()
    })

    it('refuses an id-less task row landing on the (project, date) cell a locked entry occupies', async () => {
      wireEntityManagerFind({
        locked: [{ id: LOCKED_ENTRY_ID, lockedReportId: REPORT_ID, date: AT('00:00'), timeProjectId: PROJECT_ID }],
      })

      // The row names only its task, so the cell it is checked against is the one
      // the inherited project puts it on — a task row must not slip past a lock
      // that a project row on the same cell would hit.
      const response = await post([{ date: DAY, taskId: TASK_ID, durationMinutes: 120 }])

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        code: 'time_entry_locked',
        lockedEntryIds: [LOCKED_ENTRY_ID],
      })
      expect(mockTrxCreate).not.toHaveBeenCalled()
    })
  })

  describe('tenant isolation', () => {
    it('refuses a task that resolves in another tenant', async () => {
      const response = await post([
        { date: DAY, timeProjectId: PROJECT_ID, taskId: FOREIGN_TASK_ID, durationMinutes: 60 },
      ])

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        errors: [{ path: 'entries[].taskId', value: FOREIGN_TASK_ID }],
      })
      expect(mockTrxCreate).not.toHaveBeenCalled()
    })

    it('scopes the task lookup to the caller tenant and organization', async () => {
      await post([{ date: DAY, timeProjectId: PROJECT_ID, taskId: TASK_ID, durationMinutes: 60 }])

      expect(taskQueries[0]).toMatchObject({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      })
    })
  })
})
