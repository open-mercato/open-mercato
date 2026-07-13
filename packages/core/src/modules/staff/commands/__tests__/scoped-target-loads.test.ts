import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockFindOneWithDecryption = jest.fn()

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
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const TIME_PROJECT_ID = '55555555-5555-4555-8555-555555555555'

async function loadTeamMemberUpdateCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../team-members')
  return commandRegistry.get('staff.team-members.update') as RegisteredCommand
}

async function loadTagAssignCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../tag-assignments')
  return commandRegistry.get('staff.team-members.tags.assign') as RegisteredCommand
}

async function loadTimeProjectMemberAssignCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-projects')
  return commandRegistry.get('staff.timesheets.time_project_members.assign') as RegisteredCommand
}

function buildMember(overrides: Record<string, unknown> = {}) {
  return {
    id: MEMBER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    teamId: null,
    displayName: 'Before',
    description: null,
    userId: null,
    roleIds: [],
    tags: [],
    availabilityRuleSetId: null,
    isActive: true,
    deletedAt: null,
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    ...overrides,
  }
}

function createEm() {
  const em = {
    fork: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: unknown, overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: OTHER_ORG_ID,
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

function createNullScopeCtx(em: unknown) {
  return createCtx(em, {
    auth: { sub: 'api-key-1', tenantId: null, orgId: null, isSuperAdmin: false },
    selectedOrganizationId: null,
    organizationIds: null,
  })
}

describe('staff command target scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads team member update targets with the command tenant and selected organization scope', async () => {
    const update = await loadTeamMemberUpdateCommand()
    const em = createEm()
    const member = buildMember()
    mockFindOneWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) => {
      if (where.id === MEMBER_ID && where.tenantId === TENANT_ID && where.organizationId === ORG_ID) {
        return member
      }
      return null
    })

    await expect(
      update.execute({ id: MEMBER_ID, displayName: 'After' }, createCtx(em)),
    ).resolves.toEqual({ memberId: MEMBER_ID, updatedAt: expect.any(String) })

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: MEMBER_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      }),
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(member.displayName).toBe('After')
  })

  it('does not mutate an unscoped team member target for a null-scope non-superadmin principal', async () => {
    const update = await loadTeamMemberUpdateCommand()
    const em = createEm()
    const foreignMember = buildMember({ organizationId: OTHER_ORG_ID })
    mockFindOneWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) => {
      if (where.id === MEMBER_ID && !('tenantId' in where) && !('organizationId' in where)) {
        return foreignMember
      }
      return null
    })

    await expect(
      update.execute(
        { id: MEMBER_ID, displayName: 'After' },
        createNullScopeCtx(em),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })

    expect(foreignMember.displayName).toBe('Before')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not let tag assignment choose a target scope from input under a null-scope principal', async () => {
    const assign = await loadTagAssignCommand()
    const em = createEm()

    await expect(
      assign.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, memberId: MEMBER_ID, tag: 'vip' },
        createNullScopeCtx(em),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })

    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not let project member assignment choose a target scope from input under a null-scope principal', async () => {
    const assign = await loadTimeProjectMemberAssignCommand()
    const em = createEm()

    await expect(
      assign.execute(
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          timeProjectId: TIME_PROJECT_ID,
          staffMemberId: MEMBER_ID,
          assignedStartDate: '2026-07-01',
        },
        createNullScopeCtx(em),
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })

    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
