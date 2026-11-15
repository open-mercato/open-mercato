/** @jest-environment node */
// Coverage for T2.12: re-dating a project assignment (D-12's `assigned_end_date`)
// is an UPDATE of the membership row, not an unassign + assign pair. The audit
// trail is the point of the command — a history that reads "member removed,
// member added" misstates what happened on a record used to defend an invoice.
// These tests pin: only the intended columns move, the recorded diff names
// `assignedEndDate`, undo restores the previous values, and the lookup never
// reaches outside the caller's tenant/organization or the project in the URL.
import type { AwilixContainer } from 'awilix'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'

const mockFindOneWithDecryption = jest.fn()
const mockEmitCrudSideEffects = jest.fn()
const mockEmitCrudUndoSideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudSideEffects(...args)),
    emitCrudUndoSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudUndoSideEffects(...args)),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '66666666-6666-4666-8666-666666666666'
const MEMBERSHIP_ID = '77777777-7777-4777-8777-777777777777'
const STAFF_MEMBER_ID = '88888888-8888-4888-8888-888888888888'

const COMMAND_ID = 'staff.timesheets.time_project_members.update'

type RegisteredCommand = {
  prepare?: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  execute: (input: unknown, ctx: unknown) => Promise<{ timeProjectMemberId: string }>
  buildLog?: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  undo?: (args: Record<string, unknown>) => Promise<void>
}

async function loadUpdateMemberCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-projects')
  return commandRegistry.get(COMMAND_ID) as unknown as RegisteredCommand
}

type MemberRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  staffMemberId: string
  role: string | null
  status: string
  showInGrid: boolean
  assignedStartDate: Date
  assignedEndDate: Date | null
  updatedAt: Date
  deletedAt: Date | null
}

function makeMember(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: MEMBERSHIP_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: PROJECT_ID,
    staffMemberId: STAFF_MEMBER_ID,
    role: 'Consultant',
    status: 'active',
    showInGrid: false,
    assignedStartDate: new Date('2026-01-05T00:00:00.000Z'),
    assignedEndDate: new Date('2026-01-31T00:00:00.000Z'),
    updatedAt: new Date('2026-01-05T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

type WhereClause = Record<string, unknown>

const whereCalls: WhereClause[] = []

/**
 * Emulates the DB: the row is returned only when every scalar term of the WHERE
 * clause matches, so a tenant/organization/project mismatch resolves to "not
 * found" exactly as Postgres would.
 */
function installMemberLookup(member: MemberRow | null) {
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, _cls: unknown, where: WhereClause) => {
    whereCalls.push(where)
    if (!member) return null
    const matches = Object.entries(where).every(([key, value]) => {
      if (value === null) return (member as unknown as Record<string, unknown>)[key] == null
      if (typeof value !== 'string') return true
      return (member as unknown as Record<string, unknown>)[key] === value
    })
    return matches ? member : null
  })
}

function makeEm() {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    findOne: jest.fn(async () => null),
    flush: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: unknown, overrides: { tenantId?: string; orgId?: string } = {}) {
  return {
    auth: {
      sub: 'user-1',
      tenantId: overrides.tenantId ?? TENANT_ID,
      orgId: overrides.orgId ?? ORG_ID,
    },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: overrides.orgId ?? ORG_ID,
    organizationScope: null,
    organizationIds: [overrides.orgId ?? ORG_ID],
  }
}

function updateInput(overrides: Record<string, unknown> = {}) {
  return {
    id: MEMBERSHIP_ID,
    timeProjectId: PROJECT_ID,
    assignedEndDate: '2026-12-31',
    ...overrides,
  }
}

describe(COMMAND_ID, () => {
  beforeEach(() => {
    jest.clearAllMocks()
    whereCalls.length = 0
    mockEmitCrudSideEffects.mockResolvedValue(undefined)
    mockEmitCrudUndoSideEffects.mockResolvedValue(undefined)
  })

  it('is registered so re-dating never has to be expressed as unassign + assign', async () => {
    const command = await loadUpdateMemberCommand()
    expect(command).toBeTruthy()
    expect(typeof command.execute).toBe('function')
    expect(typeof command.undo).toBe('function')
    expect(typeof command.buildLog).toBe('function')
  })

  it('moves only the fields it was given and leaves the rest of the row alone', async () => {
    const command = await loadUpdateMemberCommand()
    const member = makeMember()
    installMemberLookup(member)
    const em = makeEm()

    const result = await command.execute(updateInput(), createCtx(em))

    expect(result).toEqual({ timeProjectMemberId: MEMBERSHIP_ID })
    expect(member.assignedEndDate?.toISOString().split('T')[0]).toBe('2026-12-31')
    // Untouched: the row keeps its identity, its window start and its role.
    expect(member.timeProjectId).toBe(PROJECT_ID)
    expect(member.staffMemberId).toBe(STAFF_MEMBER_ID)
    expect(member.assignedStartDate.toISOString().split('T')[0]).toBe('2026-01-05')
    expect(member.role).toBe('Consultant')
    expect(member.status).toBe('active')
    // The row is updated in place — never soft-deleted and replaced.
    expect(member.deletedAt).toBeNull()
    expect(member.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-05T00:00:00.000Z').getTime())
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('clears the end date when null is sent, and can change role and status', async () => {
    const command = await loadUpdateMemberCommand()
    const member = makeMember()
    installMemberLookup(member)
    const em = makeEm()

    await command.execute(
      updateInput({ assignedEndDate: null, role: 'Team Leader', status: 'inactive' }),
      createCtx(em),
    )

    expect(member.assignedEndDate).toBeNull()
    expect(member.role).toBe('Team Leader')
    expect(member.status).toBe('inactive')
  })

  it('emits staff.timesheets.time_project_member.updated (not a delete + create pair)', async () => {
    const command = await loadUpdateMemberCommand()
    installMemberLookup(makeMember())
    const em = makeEm()

    await command.execute(updateInput(), createCtx(em))

    expect(mockEmitCrudSideEffects).toHaveBeenCalledTimes(1)
    const emitted = mockEmitCrudSideEffects.mock.calls[0][0] as {
      action: string
      events: CrudEventsConfig<unknown>
      indexer: { entityType: string }
    }
    expect(emitted.action).toBe('updated')
    expect(emitted.events.module).toBe('staff')
    expect(emitted.events.entity).toBe('timesheets.time_project_member')
    expect(emitted.indexer.entityType).toBe('staff:staff_time_project_member')
  })

  it('records the change as an update whose diff names assignedEndDate', async () => {
    const command = await loadUpdateMemberCommand()
    const member = makeMember()
    installMemberLookup(member)
    const em = makeEm()
    const ctx = createCtx(em)

    const snapshots = await command.prepare!(updateInput(), ctx)
    await command.execute(updateInput(), ctx)
    const log = await command.buildLog!({ snapshots, ctx, input: updateInput(), result: { timeProjectMemberId: MEMBERSHIP_ID } })

    expect(log).toBeTruthy()
    expect(log!.actionLabel).toBe('Update time project member')
    expect(log!.resourceKind).toBe('staff.timesheets.time_project_member')
    expect(log!.resourceId).toBe(MEMBERSHIP_ID)
    // This is the whole point of T2.12: the history reads "the end date changed",
    // with the same resource id before and after.
    expect(log!.changes).toEqual({
      assignedEndDate: { from: '2026-01-31', to: '2026-12-31' },
    })
    expect((log!.snapshotBefore as Record<string, unknown>).id).toBe(MEMBERSHIP_ID)
    expect((log!.snapshotAfter as Record<string, unknown>).id).toBe(MEMBERSHIP_ID)
    expect((log!.snapshotAfter as Record<string, unknown>).deletedAt).toBeNull()
  })

  it('undo restores the previous role, status and end date', async () => {
    const command = await loadUpdateMemberCommand()
    const member = makeMember()
    installMemberLookup(member)
    const em = makeEm()
    const ctx = createCtx(em)

    const snapshots = await command.prepare!(updateInput(), ctx)
    await command.execute(updateInput({ role: 'Team Leader', status: 'inactive' }), ctx)
    const log = await command.buildLog!({ snapshots, ctx, input: updateInput(), result: { timeProjectMemberId: MEMBERSHIP_ID } })

    em.findOne.mockResolvedValue(member)
    await command.undo!({ logEntry: log, ctx })

    expect(member.assignedEndDate?.toISOString().split('T')[0]).toBe('2026-01-31')
    expect(member.role).toBe('Consultant')
    expect(member.status).toBe('active')
    expect(mockEmitCrudUndoSideEffects).toHaveBeenCalledTimes(1)
    expect((mockEmitCrudUndoSideEffects.mock.calls[0][0] as { action: string }).action).toBe('updated')
  })

  it('refuses a membership that belongs to a different project', async () => {
    const command = await loadUpdateMemberCommand()
    installMemberLookup(makeMember())
    const em = makeEm()

    await expect(
      command.execute(updateInput({ timeProjectId: OTHER_PROJECT_ID }), createCtx(em)),
    ).rejects.toMatchObject({ status: 404 })

    expect(whereCalls.at(-1)).toMatchObject({ timeProjectId: OTHER_PROJECT_ID })
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('scopes the lookup by tenant and organization', async () => {
    const command = await loadUpdateMemberCommand()
    const member = makeMember()
    installMemberLookup(member)
    const em = makeEm()

    await command.execute(updateInput(), createCtx(em))

    expect(whereCalls.at(-1)).toMatchObject({
      id: MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      timeProjectId: PROJECT_ID,
      deletedAt: null,
    })
  })

  it('cannot reach a membership in another tenant', async () => {
    const command = await loadUpdateMemberCommand()
    const member = makeMember()
    installMemberLookup(member)
    const em = makeEm()

    await expect(
      command.execute(updateInput(), createCtx(em, { tenantId: OTHER_TENANT_ID })),
    ).rejects.toMatchObject({ status: 404 })

    expect(whereCalls.at(-1)).toMatchObject({ tenantId: OTHER_TENANT_ID })
    expect(member.assignedEndDate?.toISOString().split('T')[0]).toBe('2026-01-31')
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })
})
