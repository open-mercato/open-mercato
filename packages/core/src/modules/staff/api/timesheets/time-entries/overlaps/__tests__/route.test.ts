import { StaffTeamMember, StaffTimeEntry, StaffTimeProject, StaffTimeTask } from '../../../../../data/entities'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const selfMemberId = '44444444-4444-4444-8444-444444444444'
const otherMemberId = '55555555-5555-4555-8555-555555555555'
const projectId = '66666666-6666-4666-8666-666666666666'
const taskId = '77777777-7777-4777-8777-777777777777'

type EntryRow = {
  id: string
  tenantId: string
  organizationId: string
  staffMemberId: string
  date: string
  durationMinutes: number
  startedAt: Date | null
  endedAt: Date | null
  notes: string | null
  taskId: string | null
  timeProjectId: string | null
  deletedAt: Date | null
}

const clock = (date: string, time: string): Date => {
  const [hours, minutes] = time.split(':').map(Number)
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}

const entry = (overrides: Partial<EntryRow> & { id: string; date: string; start: string; end: string }): EntryRow => {
  const { start, end, ...rest } = overrides
  const startedAt = clock(rest.date, start)
  const endDate = end < start ? shift(rest.date, 1) : rest.date
  const endedAt = clock(endDate, end)
  return {
    tenantId: tenantA,
    organizationId,
    staffMemberId: selfMemberId,
    durationMinutes: Math.round((endedAt.getTime() - startedAt.getTime()) / 60000),
    notes: null,
    taskId,
    timeProjectId: projectId,
    deletedAt: null,
    ...rest,
    startedAt,
    endedAt,
  }
}

function shift(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

let entryRows: EntryRow[] = []
let memberRows: Array<{ id: string; userId: string; tenantId: string; organizationId: string; deletedAt: Date | null }> = []
let projectMemberRows: Array<{ timeProjectId: string; staffMemberId: string; assignedStartDate: string | null; assignedEndDate: string | null }> = []
let grantedFeatures: string[] = ['staff.timesheets.view']

type QueryWhere = {
  id?: { $in?: string[] }
  userId?: string
  tenantId?: string
  organizationId?: string
  staffMemberId?: string
  deletedAt?: Date | null
  date?: { $gte?: string; $lte?: string }
}

type OverlapResponse = { items: Array<Record<string, unknown>>; total: number }

const matchesRange = (value: string, range: { $gte?: string; $lte?: string }): boolean => {
  if (range.$gte !== undefined && value < range.$gte) return false
  if (range.$lte !== undefined && value > range.$lte) return false
  return true
}

const findWithDecryption = jest.fn(
  async (_em: unknown, entity: unknown, where: QueryWhere) => {
    if (entity === StaffTimeEntry) {
      return entryRows.filter(
        (row) =>
          row.tenantId === where.tenantId &&
          row.organizationId === where.organizationId &&
          row.staffMemberId === where.staffMemberId &&
          row.deletedAt === null &&
          matchesRange(row.date, where.date ?? {}),
      )
    }
    if (entity === StaffTimeTask) {
      return where.id?.$in?.includes(taskId) ? [{ id: taskId, title: 'Przegląd zapytań SQL' }] : []
    }
    if (entity === StaffTimeProject) {
      return where.id?.$in?.includes(projectId)
        ? [{ id: projectId, name: 'Ambra — audyt wydajności' }]
        : []
    }
    return projectMemberRows.filter((row) => row.staffMemberId === where.staffMemberId)
  },
)

const findOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: QueryWhere) => {
  if (entity === StaffTeamMember) {
    return (
      memberRows.find(
        (row) =>
          row.userId === where.userId &&
          row.tenantId === where.tenantId &&
          row.organizationId === where.organizationId &&
          row.deletedAt === null,
      ) ?? null
    )
  }
  return null
})

const em = { fork: () => em }

const container = {
  hasRegistration: (name: string) => ['em', 'rbacService', 'moduleConfigService'].includes(name),
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return {
      getGrantedFeatures: async () => grantedFeatures,
      // Same grants, asked the way the code now asks — a test that grants a
      // feature must still grant it once the check goes through the service.
      userHasAllFeatures: async (_u: string, required: string[]) =>
        required.every((feature: string) =>
          (grantedFeatures ?? []).some((grant: string) =>
            grant === '*' || grant === feature || (grant.endsWith('.*') && feature.startsWith(grant.slice(0, -1))),
          ),
        ),
    }
    if (name === 'moduleConfigService') throw new Error('[internal] moduleConfigService not registered')
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = {
  tenantId: tenantA,
  sub: userId,
  orgId: organizationId,
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) =>
    (findWithDecryption as unknown as (...a: unknown[]) => unknown)(...args),
  findOneWithDecryption: (...args: unknown[]) =>
    (findOneWithDecryption as unknown as (...a: unknown[]) => unknown)(...args),
}))

import { GET, metadata } from '../route'

const today = '2026-07-20'

const request = (params: Record<string, string>) => {
  const url = new URL('http://localhost/api/staff/timesheets/time-entries/overlaps')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url)
}

const callOverlaps = async (params: Record<string, string>) => {
  const response = await GET(request(params))
  return { status: response.status, body: (await response.json()) as OverlapResponse }
}

describe('staff timesheets time-entry overlaps route', () => {
  beforeEach(() => {
    container.resolve.mockClear()
    findWithDecryption.mockClear()
    findOneWithDecryption.mockClear()
    grantedFeatures = ['staff.timesheets.view']
    authValue = { tenantId: tenantA, sub: userId, orgId: organizationId }
    memberRows = [
      { id: selfMemberId, userId, tenantId: tenantA, organizationId, deletedAt: null },
    ]
    projectMemberRows = [
      { timeProjectId: projectId, staffMemberId: selfMemberId, assignedStartDate: null, assignedEndDate: null },
    ]
    entryRows = [
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', date: today, start: '11:45', end: '13:30' }),
    ]
  })

  it('declares the advisory read guard', () => {
    expect(metadata.GET.requireAuth).toBe(true)
    expect(metadata.GET.requireFeatures).toEqual(['staff.timesheets.view'])
  })

  it('reports an exact overlap with the label data screen 9 renders', async () => {
    const { status, body } = await callOverlaps({ date: today, startedAt: '11:45', endedAt: '13:30' })

    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      started_at: '11:45',
      ended_at: '13:30',
      duration_minutes: 105,
      overlap_minutes: 105,
      task_title: 'Przegląd zapytań SQL',
      project_name: 'Ambra — audyt wydajności',
    })
  })

  it('reports a partial overlap with the intersected duration', async () => {
    const { body } = await callOverlaps({ date: today, startedAt: '11:00', endedAt: '13:00' })

    expect(body.total).toBe(1)
    expect(body.items[0].overlap_minutes).toBe(75)
  })

  it('reports containment when the candidate swallows the stored entry', async () => {
    const { body } = await callOverlaps({ date: today, startedAt: '09:00', endedAt: '18:00' })

    expect(body.total).toBe(1)
    expect(body.items[0].overlap_minutes).toBe(105)
  })

  it('does not treat touching edges as an overlap', async () => {
    entryRows = [entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', date: today, start: '10:00', end: '11:00' })]

    const { body } = await callOverlaps({ date: today, startedAt: '09:00', endedAt: '10:00' })

    expect(body).toEqual({ items: [], total: 0 })
  })

  it('accepts a start plus duration instead of an explicit end', async () => {
    const { body } = await callOverlaps({ date: today, startedAt: '12:00', durationMinutes: '60' })

    expect(body.total).toBe(1)
    expect(body.items[0].overlap_minutes).toBe(60)
  })

  it('suppresses the entry being edited via excludeId', async () => {
    const { body } = await callOverlaps({
      date: today,
      startedAt: '11:45',
      endedAt: '13:30',
      excludeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    })

    expect(body).toEqual({ items: [], total: 0 })
  })

  it('matches a midnight-crossing candidate against an entry on the following day', async () => {
    entryRows = [
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', date: shift(today, 1), start: '00:15', end: '02:00' }),
    ]

    const { body } = await callOverlaps({ date: today, startedAt: '23:00', endedAt: '01:00' })

    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({
      date: shift(today, 1),
      started_at: '00:15',
      overlap_minutes: 45,
    })
    const entryQuery = findWithDecryption.mock.calls.find((call) => call[1] === StaffTimeEntry)
    expect((entryQuery?.[2] as QueryWhere).date).toEqual({
      $gte: shift(today, -1),
      $lte: shift(today, 1),
    })
  })

  it('matches a stored entry that started the previous evening', async () => {
    entryRows = [
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', date: shift(today, -1), start: '22:30', end: '01:30' }),
    ]

    const { body } = await callOverlaps({ date: today, startedAt: '01:00', endedAt: '02:00' })

    expect(body.total).toBe(1)
    expect(body.items[0].overlap_minutes).toBe(30)
  })

  it('silently scopes a caller without manage_all back to their own entries', async () => {
    entryRows = [
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', date: today, start: '11:45', end: '13:30', staffMemberId: otherMemberId }),
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', date: today, start: '12:00', end: '12:30' }),
    ]

    const { status, body } = await callOverlaps({
      date: today,
      startedAt: '11:00',
      endedAt: '14:00',
      staffMemberId: otherMemberId,
    })

    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items[0].staff_member_id).toBe(selfMemberId)
    const entryQuery = findWithDecryption.mock.calls.find((call) => call[1] === StaffTimeEntry)
    expect((entryQuery?.[2] as QueryWhere).staffMemberId).toBe(selfMemberId)
  })

  it('checks another member once manage_all is granted', async () => {
    grantedFeatures = ['staff.timesheets.view', 'staff.timesheets.manage_all']
    entryRows = [
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', date: today, start: '11:45', end: '13:30', staffMemberId: otherMemberId }),
    ]

    const { body } = await callOverlaps({
      date: today,
      startedAt: '11:00',
      endedAt: '14:00',
      staffMemberId: otherMemberId,
    })

    expect(body.total).toBe(1)
    expect(body.items[0].staff_member_id).toBe(otherMemberId)
  })

  it('hides entries on projects the caller cannot see', async () => {
    projectMemberRows = []

    const { body } = await callOverlaps({ date: today, startedAt: '11:45', endedAt: '13:30' })

    expect(body).toEqual({ items: [], total: 0 })
  })

  it('still warns about the caller own entries that carry no project', async () => {
    projectMemberRows = []
    entryRows = [
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', date: today, start: '11:45', end: '13:30', timeProjectId: null, taskId: null }),
    ]

    const { body } = await callOverlaps({ date: today, startedAt: '11:45', endedAt: '13:30' })

    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ time_project_id: null, project_name: null, task_title: null })
  })

  it('never reads across tenants', async () => {
    entryRows = [
      entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', date: today, start: '11:45', end: '13:30', tenantId: tenantB }),
    ]

    const { body } = await callOverlaps({ date: today, startedAt: '11:45', endedAt: '13:30' })

    expect(body).toEqual({ items: [], total: 0 })
    const entryQuery = findWithDecryption.mock.calls.find((call) => call[1] === StaffTimeEntry)
    expect(entryQuery?.[2]).toMatchObject({ tenantId: tenantA, organizationId })
  })

  it('returns no warning when the time information is insufficient', async () => {
    const { status, body } = await callOverlaps({ date: today, startedAt: '11:45' })

    expect(status).toBe(200)
    expect(body).toEqual({ items: [], total: 0 })
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('returns no warning for a zero-length candidate', async () => {
    const { status, body } = await callOverlaps({ date: today, startedAt: '11:45', endedAt: '11:45' })

    expect(status).toBe(200)
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('returns no warning when the caller has no linked staff member', async () => {
    memberRows = []

    const { status, body } = await callOverlaps({ date: today, startedAt: '11:45', endedAt: '13:30' })

    expect(status).toBe(200)
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('rejects a malformed date without touching the database', async () => {
    const { status } = await callOverlaps({ date: '20-07-2026', startedAt: '11:45', endedAt: '13:30' })

    expect(status).toBe(400)
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null

    const { status } = await callOverlaps({ date: today, startedAt: '11:45', endedAt: '13:30' })

    expect(status).toBe(401)
  })
})
