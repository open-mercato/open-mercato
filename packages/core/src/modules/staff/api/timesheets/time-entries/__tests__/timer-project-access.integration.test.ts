/** @jest-environment node */
import { commandRegistry, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  StaffTeamMember,
  StaffTimeEntry,
  StaffTimeEntrySegment,
  StaffTimeProject,
  StaffTimeProjectMember,
} from '../../../../data/entities'
import '../../../../commands/timesheets-entries'
import { POST as startNewTimer } from '../start-timer/route'
import { POST as startExistingTimer } from '../[id]/timer-start/route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const ENTRY_ID = '66666666-6666-4666-8666-666666666666'
const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockHasAllFeatures = jest.fn(
  async (_userId: string, _features: string[], roleScope: typeof scope) =>
    roleScope.organizationId === OTHER_ORGANIZATION_ID,
)
const mockEm = {
  findOne: jest.fn(),
  fork: jest.fn(),
  isInTransaction: jest.fn(() => true),
  execute: jest.fn(),
  transactional: jest.fn(),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: ENTRY_ID, ...data })),
  flush: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve(token: string) {
      if (token === 'em') return mockEm
      if (token === 'rbacService') return { userHasAllFeatures: mockHasAllFeatures }
      if (token === 'commandBus') {
        return {
          async execute(id: string, { input, ctx }: { input: unknown; ctx: CommandRuntimeContext }) {
            const command = commandRegistry.get(id)
            if (!command) throw new Error(`[internal] Unregistered command ${id}`)
            return { result: await command.execute(input, ctx) }
          },
        }
      }
      return null
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'synthetic-user', tenantId: TENANT_ID, orgId: OTHER_ORGANIZATION_ID }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({
    tenantId: TENANT_ID,
    selectedId: ORGANIZATION_ID,
    filterIds: [ORGANIZATION_ID],
    allowedIds: [ORGANIZATION_ID, OTHER_ORGANIZATION_ID],
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/staff/api/guards', () => ({
  STAFF_TIME_TRACKING_RESOURCE_KINDS: { timeEntry: 'staff.timesheets.time_entry' },
  runStaffMutationGuards: async () => ({ ok: true, afterSuccessCallbacks: [] }),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn().mockResolvedValue(undefined),
}))

function membership(organizationId = ORGANIZATION_ID) {
  return {
    tenantId: TENANT_ID,
    organizationId,
    staffMemberId: MEMBER_ID,
    status: 'active',
    deletedAt: null,
    timeProjectId: PROJECT_ID,
    assignedStartDate: new Date(2026, 0, 15),
    assignedEndDate: null,
  }
}

function timerFixture(date: string, memberships: ReturnType<typeof membership>[]) {
  const entry = {
    ...scope,
    id: ENTRY_ID,
    staffMemberId: MEMBER_ID,
    timeProjectId: PROJECT_ID,
    date: new Date(date),
    source: 'manual',
    startedAt: null,
    endedAt: null,
  }
  mockEm.findOne.mockImplementation(async (entity, where) => {
    expect(entity).toBe(StaffTimeProject)
    expect(where).toMatchObject({ ...scope, id: PROJECT_ID, deletedAt: null })
    return { id: PROJECT_ID }
  })
  mockFindOneWithDecryption.mockImplementation(async (_em, entity, where, _options, queryScope) => {
    expect(queryScope).toEqual(scope)
    if (entity === StaffTeamMember) {
      expect(where).toMatchObject({ ...scope, userId: 'synthetic-user', deletedAt: null })
      return { id: MEMBER_ID }
    }
    if (entity === StaffTimeEntry && where.id === ENTRY_ID) {
      expect(where).toMatchObject({ ...scope, deletedAt: null })
      return entry
    }
    return null
  })
  mockFindWithDecryption.mockImplementation(async (_em, entity, where, _options, queryScope) => {
    expect(entity).toBe(StaffTimeProjectMember)
    expect(queryScope).toEqual(scope)
    expect(where).toMatchObject({ ...scope, staffMemberId: MEMBER_ID, status: 'active', deletedAt: null })
    return memberships.filter((record) =>
      record.tenantId === where.tenantId && record.organizationId === where.organizationId,
    )
  })
  return entry
}

function newTimerRequest(date: string) {
  return new Request('http://timesheet.test.invalid/api/staff/timesheets/time-entries/start-timer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ staffMemberId: MEMBER_ID, timeProjectId: PROJECT_ID, date }),
  })
}

function existingTimerRequest() {
  return new Request(`http://timesheet.test.invalid/api/staff/timesheets/time-entries/${ENTRY_ID}/timer-start`, {
    method: 'POST',
  })
}

describe.each([
  { kind: 'new entry', post: startNewTimer, request: newTimerRequest, success: 201 },
  { kind: 'existing entry', post: startExistingTimer, request: existingTimerRequest, success: 200 },
])('timer start for $kind', ({ post, request, success }) => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2026-02-01T12:00:00.000Z') })
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.transactional.mockImplementation(async (callback: (em: typeof mockEm) => Promise<unknown>) => callback(mockEm))
  })

  afterEach(() => jest.useRealTimers())

  it('accepts an in-scope assignment covering the date', async () => {
    const date = '2026-01-20'
    timerFixture(date, [membership()])

    expect((await post(request(date))).status).toBe(success)
    expect(mockEm.create).toHaveBeenCalledWith(StaffTimeEntrySegment, expect.objectContaining(scope))
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it.each([
    {
      date: '2026-01-20', organizationId: OTHER_ORGANIZATION_ID,
      message: 'You are not assigned to this project.',
    },
    {
      date: '2026-01-14', organizationId: ORGANIZATION_ID,
      message: 'This date is outside your assignment to this project.',
    },
  ])('rejects the synthetic assignment before either timer write: $message', async ({ date, organizationId, message }) => {
    const entry = timerFixture(date, [membership(organizationId)])

    const response = await post(request(date))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: message })
    expect(mockHasAllFeatures).toHaveBeenCalledWith('synthetic-user', ['staff.timesheets.manage_all'], scope)
    expect(entry.startedAt).toBeNull()
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.flush).not.toHaveBeenCalled()
  })
})
