import type { AwilixContainer } from 'awilix'

const mockFindOneWithDecryption = jest.fn()
const mockLoadCustomFieldSnapshot = jest.fn()
const mockSetCustomFieldsIfAny = jest.fn()
const mockEmitCrudUndoSideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  buildCustomFieldResetMap: jest.fn(() => ({})),
  diffCustomFieldChanges: jest.fn(() => ({})),
  loadCustomFieldSnapshot: jest.fn((...args: unknown[]) => mockLoadCustomFieldSnapshot(...args)),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudUndoSideEffects(...args)),
    setCustomFieldsIfAny: jest.fn((...args: unknown[]) => mockSetCustomFieldsIfAny(...args)),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type RegisteredCommand = {
  prepare?: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  captureAfter?: (input: unknown, result: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: { input?: unknown; result?: unknown; ctx: unknown; snapshots: Record<string, unknown> }) => Promise<unknown>
  undo?: (args: { input?: unknown; ctx: unknown; logEntry: unknown }) => Promise<void>
  redo?: (args: { input?: unknown; ctx: unknown; logEntry: unknown }) => Promise<unknown>
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TEAM_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG_ID = '44444444-4444-4444-8444-444444444444'
const LEAVE_REQUEST_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '66666666-6666-4666-8666-666666666666'

function makeTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Engineering',
    description: null,
    isActive: true,
    deletedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeTeamSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Engineering',
    description: null,
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

function makeLeaveRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAVE_REQUEST_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    memberId: MEMBER_ID,
    startDate: '2026-01-10T00:00:00.000Z',
    endDate: '2026-01-11T00:00:00.000Z',
    timezone: 'UTC',
    status: 'pending',
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    note: null,
    decisionComment: null,
    submittedByUserId: null,
    decidedByUserId: null,
    decidedAt: null,
    deletedAt: '2026-01-12T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function createCtx(em: unknown, overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      isSuperAdmin: false,
    },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
    ...overrides,
  }
}

async function loadTeamCommands() {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../teams')
  return {
    create: commandRegistry.get('staff.teams.create') as RegisteredCommand,
    update: commandRegistry.get('staff.teams.update') as RegisteredCommand,
  }
}

async function loadLeaveRequestCommands() {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../leave-requests')
  return {
    create: commandRegistry.get('staff.leave-requests.create') as RegisteredCommand,
  }
}

function expectTenantScopedSnapshotLoad(callIndex: number) {
  const call = mockFindOneWithDecryption.mock.calls[callIndex]
  expect(call?.[2]).toMatchObject({
    id: TEAM_ID,
    tenantId: TENANT_ID,
  })
  expect(call?.[2]).not.toHaveProperty('organizationId')
  expect(call?.[4]).toEqual({
    tenantId: TENANT_ID,
    organizationId: null,
  })
}

function expectSnapshotScopedTeamLoad(callIndex: number) {
  const call = mockFindOneWithDecryption.mock.calls[callIndex]
  expect(call?.[2]).toMatchObject({
    id: TEAM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  })
  expect(call?.[4]).toEqual({
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  })
}

describe('staff command audit snapshot scoping (#3913)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockResolvedValue(makeTeam())
    mockLoadCustomFieldSnapshot.mockResolvedValue({})
    mockSetCustomFieldsIfAny.mockResolvedValue(undefined)
    mockEmitCrudUndoSideEffects.mockResolvedValue(undefined)
  })

  it('keeps pre-validation snapshot reads tenant-scoped so all-organization users do not lose audit snapshots', async () => {
    const { update } = await loadTeamCommands()
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(makeTeam()),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const ctx = createCtx(em, {
      selectedOrganizationId: OTHER_ORG_ID,
      organizationScope: {
        selectedId: OTHER_ORG_ID,
        tenantId: TENANT_ID,
        allowedIds: [ORG_ID, OTHER_ORG_ID],
        filterIds: [OTHER_ORG_ID],
      },
      organizationIds: [ORG_ID, OTHER_ORG_ID],
    })

    await update.prepare?.({ id: TEAM_ID }, ctx)

    expectTenantScopedSnapshotLoad(0)
  })

  it('scopes after-log snapshot reads to the tenant and organization stored in the before snapshot', async () => {
    const { update } = await loadTeamCommands()
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(makeTeam()),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const ctx = createCtx(em)

    await update.buildLog?.({
      input: { id: TEAM_ID },
      result: { teamId: TEAM_ID },
      ctx,
      snapshots: { before: makeTeamSnapshot() },
    })

    expectSnapshotScopedTeamLoad(0)
  })

  it('scopes undo target loads to the tenant and organization stored in the undo snapshot', async () => {
    const { update } = await loadTeamCommands()
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(makeTeam()),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const ctx = createCtx(em)
    const before = makeTeamSnapshot({ name: 'Before' })
    const after = makeTeamSnapshot({ name: 'After' })

    await update.undo?.({
      ctx,
      logEntry: { commandPayload: { undo: { before, after, customBefore: null, customAfter: null } } },
    })

    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), {
      id: TEAM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('scopes leave-request create redo lookup to the tenant and organization stored in the snapshot', async () => {
    const { create } = await loadLeaveRequestCommands()
    const leaveRequest = makeLeaveRequest({ deletedAt: new Date('2026-01-12T00:00:00.000Z') })
    mockFindOneWithDecryption.mockResolvedValueOnce(leaveRequest)
    const em = {
      fork: jest.fn().mockReturnThis(),
      flush: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      persist: jest.fn(),
    }
    const ctx = createCtx(em)
    const snapshot = makeLeaveRequest()

    await create.redo?.({
      ctx,
      logEntry: {
        resourceId: LEAVE_REQUEST_ID,
        commandPayload: { undo: { after: snapshot } },
      },
    })

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.any(Function),
      {
        id: LEAVE_REQUEST_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      },
      undefined,
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      },
    )
  })
})
