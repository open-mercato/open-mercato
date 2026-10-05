/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (
    _em: unknown,
    phases: Array<() => unknown | Promise<unknown>>,
  ) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/core/modules/directory/lib/hierarchy', () => ({
  lockOrganizationHierarchyForTenant: jest.fn(async () => []),
  rebuildHierarchyForTenant: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots')
  return {
    ...actual,
    loadCustomFieldSnapshot: jest.fn(async () => ({})),
  }
})

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => {}),
    setCustomFieldsIfAny: jest.fn(async () => {}),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/core/modules/directory/commands/organizations'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CommandBus, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'

const ACTOR_TENANT_ID = '11111111-1111-4111-8111-111111111111'
const FOREIGN_TENANT_ID = '22222222-2222-4222-8222-222222222222'
const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PARENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CHILD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type TestOrganization = Organization & {
  tenant: { id: string }
}

type OrganizationUpdateHandler = CommandHandler<Record<string, unknown>, Organization>
type OrganizationDeleteInput = { body: { id: string }; query: Record<string, string> }
type OrganizationDeleteHandler = CommandHandler<OrganizationDeleteInput, Organization>

function makeOrganization(
  id: string,
  tenantId: string,
  overrides: Partial<TestOrganization> = {},
): TestOrganization {
  return {
    id,
    tenant: { id: tenantId },
    name: `Organization ${id}`,
    slug: null,
    logoUrl: null,
    logoPreserveAspectRatio: false,
    isActive: true,
    parentId: null,
    ancestorIds: [],
    childIds: [],
    descendantIds: [],
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as TestOrganization
}

function tenantIdOf(organization: TestOrganization): string {
  return String(organization.tenant.id)
}

function matchesFilter(organization: TestOrganization, filter: Record<string, unknown>): boolean {
  if (filter.id && typeof filter.id === 'string' && String(organization.id) !== filter.id) return false
  const idFilter = filter.id
  if (idFilter && typeof idFilter === 'object' && '$in' in idFilter) {
    const ids = (idFilter as { $in: string[] }).$in.map(String)
    if (!ids.includes(String(organization.id))) return false
  }
  if (typeof filter.tenant === 'string' && tenantIdOf(organization) !== filter.tenant) return false
  if (typeof filter.parentId === 'string' && organization.parentId !== filter.parentId) return false
  if (filter.deletedAt === null && organization.deletedAt !== null) return false
  return true
}

function makeHarness(organizations: TestOrganization[]) {
  const records = [...organizations]
  const logs: Array<Record<string, unknown>> = []
  const em = {
    findOne: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) => {
      return records.find((organization) => matchesFilter(organization, filter)) ?? null
    }),
    find: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) => {
      return records.filter((organization) => matchesFilter(organization, filter))
    }),
    persist: jest.fn(() => ({ flush: jest.fn(async () => {}) })),
    flush: jest.fn(async () => {}),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)

  const updateOrmEntity = jest.fn(async ({
    where,
    apply,
  }: {
    where: Record<string, unknown>
    apply: (organization: TestOrganization) => void
  }) => {
    const organization = records.find((candidate) => matchesFilter(candidate, where)) ?? null
    if (!organization) return null
    apply(organization)
    return organization
  })
  const deleteOrmEntity = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const organization = records.find((candidate) => matchesFilter(candidate, where)) ?? null
    if (!organization) return null
    organization.deletedAt = new Date('2026-10-04T00:00:00.000Z')
    return organization
  })
  const dataEngine = {
    updateOrmEntity,
    deleteOrmEntity,
    setCustomFields: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }

  const actionLogService = {
    log: jest.fn(async (payload: Record<string, unknown>) => {
      const entry = {
        id: `log-${logs.length + 1}`,
        executionState: 'done',
        changesJson: payload.changes ?? null,
        contextJson: payload.context ?? null,
        ...payload,
      }
      logs.push(entry)
      return entry
    }),
    findByUndoToken: jest.fn(async (undoToken: string) => (
      logs.find((entry) => entry.undoToken === undoToken) ?? null
    )),
    claimForUndo: jest.fn(async () => true),
    releaseUndoClaim: jest.fn(async () => true),
    markUndone: jest.fn(async () => null),
  }

  return { actionLogService, dataEngine, deleteOrmEntity, em, logs, records, updateOrmEntity }
}

function makeContext(
  harness: ReturnType<typeof makeHarness>,
  options: { isSuperAdmin?: boolean; systemActor?: boolean; tenantId?: string | null } = {},
) {
  const isSuperAdmin = options.isSuperAdmin ?? false
  const auth = options.systemActor
    ? null
    : {
        sub: 'user-1',
        tenantId: options.tenantId === undefined ? ACTOR_TENANT_ID : options.tenantId,
        orgId: null,
        isSuperAdmin,
      }
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return harness.em
        if (token === 'dataEngine') return harness.dataEngine
        if (token === 'actionLogService') return harness.actionLogService
        if (token === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin }) }
        throw new Error(`[internal] Unexpected DI token: ${token}`)
      },
    },
    auth,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    systemActor: options.systemActor ?? false,
  } as unknown as Parameters<CommandHandler['execute']>[1]
}

type CommandScenario = {
  commandId: 'directory.organizations.update' | 'directory.organizations.delete'
  input: Record<string, unknown> | OrganizationDeleteInput
  label: 'update' | 'delete'
}

const commandScenarios: CommandScenario[] = [
  {
    commandId: 'directory.organizations.update',
    input: { id: TARGET_ID, name: 'Updated by global actor' },
    label: 'update',
  },
  {
    commandId: 'directory.organizations.delete',
    input: { body: { id: TARGET_ID }, query: {} },
    label: 'delete',
  },
]

type GlobalActorScenario = CommandScenario & {
  actorLabel: 'superadmin' | 'system actor'
  actorOptions: { isSuperAdmin?: boolean; systemActor?: boolean }
}

const globalActorScenarios: GlobalActorScenario[] = [
  ...commandScenarios.map((scenario) => ({
    ...scenario,
    actorLabel: 'superadmin' as const,
    actorOptions: { isSuperAdmin: true },
  })),
  ...commandScenarios.map((scenario) => ({
    ...scenario,
    actorLabel: 'system actor' as const,
    actorOptions: { systemActor: true },
  })),
]

function expectTenantQualifiedUndoTarget(
  scenario: CommandScenario,
  harness: ReturnType<typeof makeHarness>,
) {
  if (scenario.label === 'update') {
    expect(harness.updateOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, tenant: FOREIGN_TENANT_ID },
    }))
    return
  }
  expect(harness.em.findOne).toHaveBeenCalledWith(Organization, {
    id: TARGET_ID,
    tenant: FOREIGN_TENANT_ID,
  })
}

function expectTenantQualifiedFinalMutation(
  scenario: CommandScenario,
  harness: ReturnType<typeof makeHarness>,
) {
  const expectedWhere = { id: TARGET_ID, deletedAt: null, tenant: FOREIGN_TENANT_ID }
  if (scenario.label === 'update') {
    expect(harness.updateOrmEntity).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    return
  }
  expect(harness.deleteOrmEntity).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
}

function expectNotFound(error: unknown) {
  expect(error).toBeInstanceOf(CrudHttpError)
  expect((error as CrudHttpError).status).toBe(404)
}

function primeChangedCustomFieldSnapshots() {
  jest.mocked(loadCustomFieldSnapshot)
    .mockResolvedValueOnce({ status: 'before' })
    .mockResolvedValueOnce({ status: 'after' })
    .mockResolvedValueOnce({ status: 'after' })
}

function clearUndoObservationMocks(harness: ReturnType<typeof makeHarness>) {
  harness.updateOrmEntity.mockClear()
  harness.dataEngine.setCustomFields.mockClear()
  harness.dataEngine.markOrmEntityChange.mockClear()
  harness.dataEngine.flushOrmEntityChanges.mockClear()
  harness.em.find.mockClear()
  harness.em.persist.mockClear()
  jest.mocked(rebuildHierarchyForTenant).mockClear()
}

function expectFailedUndoReleasedClaim(
  harness: ReturnType<typeof makeHarness>,
  logEntry: NonNullable<Awaited<ReturnType<CommandBus['execute']>>['logEntry']>,
) {
  expect(harness.dataEngine.setCustomFields).not.toHaveBeenCalled()
  expect(harness.em.find).not.toHaveBeenCalled()
  expect(harness.em.persist).not.toHaveBeenCalled()
  expect(rebuildHierarchyForTenant).not.toHaveBeenCalled()
  expect(harness.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  expect(harness.dataEngine.flushOrmEntityChanges).not.toHaveBeenCalled()
  expect(harness.actionLogService.markUndone).not.toHaveBeenCalled()
  expect(harness.actionLogService.releaseUndoClaim).toHaveBeenCalledWith(logEntry.id)
}

describe('directory organization command tenant ownership', () => {
  const updateHandler = commandRegistry.get('directory.organizations.update') as OrganizationUpdateHandler
  const deleteHandler = commandRegistry.get('directory.organizations.delete') as OrganizationDeleteHandler

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects a forged caller tenant before update prepare snapshots a foreign target', async () => {
    const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID, { childIds: [CHILD_ID] })
    const child = makeOrganization(CHILD_ID, FOREIGN_TENANT_ID, { parentId: TARGET_ID })
    const harness = makeHarness([target, child])
    const ctx = makeContext(harness)

    let captured: unknown
    try {
      await updateHandler.prepare?.({ id: TARGET_ID, tenantId: ACTOR_TENANT_ID, name: 'Forged' }, ctx)
    } catch (error) {
      captured = error
    }

    expectNotFound(captured)
    expect(harness.em.findOne).toHaveBeenCalledWith(Organization, {
      id: TARGET_ID,
      deletedAt: null,
      tenant: ACTOR_TENANT_ID,
    })
    expect(harness.em.find).not.toHaveBeenCalled()
    expect(loadCustomFieldSnapshot).not.toHaveBeenCalled()
  })

  it('rejects forged-tenant update before the final mutation', async () => {
    const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
    const harness = makeHarness([target])
    const ctx = makeContext(harness)

    await expect(
      updateHandler.execute({ id: TARGET_ID, tenantId: ACTOR_TENANT_ID, name: 'Forged' }, ctx),
    ).rejects.toMatchObject({ status: 404 })

    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(rebuildHierarchyForTenant).not.toHaveBeenCalled()
  })

  it.each([
    ['parent', { parentId: PARENT_ID }],
    ['child', { childIds: [CHILD_ID] }],
  ])('rejects a forged-tenant %s move before hierarchy reads or writes', async (_label, hierarchyInput) => {
    const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
    const parent = makeOrganization(PARENT_ID, ACTOR_TENANT_ID)
    const child = makeOrganization(CHILD_ID, ACTOR_TENANT_ID)
    const harness = makeHarness([target, parent, child])
    const ctx = makeContext(harness)

    await expect(
      updateHandler.execute({
        id: TARGET_ID,
        tenantId: ACTOR_TENANT_ID,
        ...hierarchyInput,
      }, ctx),
    ).rejects.toMatchObject({ status: 404 })

    expect(harness.em.find).not.toHaveBeenCalled()
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(rebuildHierarchyForTenant).not.toHaveBeenCalled()
  })

  it('rejects foreign delete prepare before snapshots and rejects the final delete', async () => {
    const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID, { childIds: [CHILD_ID] })
    const child = makeOrganization(CHILD_ID, FOREIGN_TENANT_ID, { parentId: TARGET_ID })
    const harness = makeHarness([target, child])
    const ctx = makeContext(harness)
    const input = { body: { id: TARGET_ID }, query: {} }

    await expect(deleteHandler.prepare?.(input, ctx)).rejects.toMatchObject({ status: 404 })
    expect(harness.em.find).not.toHaveBeenCalled()
    expect(loadCustomFieldSnapshot).not.toHaveBeenCalled()

    await expect(deleteHandler.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
    expect(harness.deleteOrmEntity).not.toHaveBeenCalled()
  })

  it('keeps same-tenant updates and parent/child moves tenant-qualified', async () => {
    const target = makeOrganization(TARGET_ID, ACTOR_TENANT_ID)
    const parent = makeOrganization(PARENT_ID, ACTOR_TENANT_ID)
    const child = makeOrganization(CHILD_ID, ACTOR_TENANT_ID)
    const harness = makeHarness([target, parent, child])
    const ctx = makeContext(harness)

    await updateHandler.execute({
      id: TARGET_ID,
      tenantId: ACTOR_TENANT_ID,
      name: 'Updated',
      parentId: PARENT_ID,
      childIds: [CHILD_ID],
    }, ctx)

    expect(harness.updateOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, deletedAt: null, tenant: ACTOR_TENANT_ID },
    }))
    expect(target.name).toBe('Updated')
    expect(target.parentId).toBe(PARENT_ID)
    expect(child.parentId).toBe(TARGET_ID)
    expect(rebuildHierarchyForTenant).toHaveBeenCalledWith(harness.em, ACTOR_TENANT_ID)
  })

  it('keeps same-tenant deletes tenant-qualified', async () => {
    const target = makeOrganization(TARGET_ID, ACTOR_TENANT_ID)
    const harness = makeHarness([target])
    const ctx = makeContext(harness)

    await deleteHandler.execute({ body: { id: TARGET_ID }, query: {} }, ctx)

    expect(harness.deleteOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, deletedAt: null, tenant: ACTOR_TENANT_ID },
    }))
    expect(rebuildHierarchyForTenant).toHaveBeenCalledWith(harness.em, ACTOR_TENANT_ID)
  })

  it('lets a superadmin update and move a foreign target using the target tenant', async () => {
    const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
    const parent = makeOrganization(PARENT_ID, FOREIGN_TENANT_ID)
    const child = makeOrganization(CHILD_ID, FOREIGN_TENANT_ID)
    const harness = makeHarness([target, parent, child])
    const ctx = makeContext(harness, { isSuperAdmin: true })

    await updateHandler.execute({
      id: TARGET_ID,
      tenantId: ACTOR_TENANT_ID,
      parentId: PARENT_ID,
      childIds: [CHILD_ID],
    }, ctx)

    expect(harness.em.findOne).toHaveBeenCalledWith(Organization, { id: TARGET_ID, deletedAt: null })
    expect(harness.updateOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, deletedAt: null, tenant: FOREIGN_TENANT_ID },
    }))
    expect(target.parentId).toBe(PARENT_ID)
    expect(child.parentId).toBe(TARGET_ID)
    expect(rebuildHierarchyForTenant).toHaveBeenCalledWith(harness.em, FOREIGN_TENANT_ID)
  })

  it('lets a superadmin delete a foreign target using the target tenant', async () => {
    const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
    const harness = makeHarness([target])
    const ctx = makeContext(harness, { isSuperAdmin: true })

    await deleteHandler.execute({ body: { id: TARGET_ID }, query: {} }, ctx)

    expect(harness.deleteOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, deletedAt: null, tenant: FOREIGN_TENANT_ID },
    }))
    expect(rebuildHierarchyForTenant).toHaveBeenCalledWith(harness.em, FOREIGN_TENANT_ID)
  })

  it('keeps explicit system-actor access global while deriving target tenant scope', async () => {
    const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
    const harness = makeHarness([target])
    const ctx = makeContext(harness, { systemActor: true })

    await updateHandler.execute({ id: TARGET_ID, tenantId: ACTOR_TENANT_ID, name: 'System update' }, ctx)

    expect(harness.updateOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, deletedAt: null, tenant: FOREIGN_TENANT_ID },
    }))
    expect(target.name).toBe('System update')
    expect(rebuildHierarchyForTenant).toHaveBeenCalledWith(harness.em, FOREIGN_TENANT_ID)
  })

  it.each(commandScenarios)(
    'persists a superadmin foreign-target $label log only in the target tenant',
    async (scenario) => {
      const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
      const harness = makeHarness([target])
      const ctx = makeContext(harness, { isSuperAdmin: true })

      const { logEntry } = await new CommandBus().execute(scenario.commandId, {
        input: scenario.input,
        ctx,
      })

      expect(logEntry).toMatchObject({
        actorUserId: 'user-1',
        commandId: scenario.commandId,
        resourceId: TARGET_ID,
        tenantId: FOREIGN_TENANT_ID,
      })
      expect(harness.logs).toHaveLength(1)
      expect(harness.logs.some((entry) => entry.tenantId === ACTOR_TENANT_ID)).toBe(false)
    },
  )

  it.each(commandScenarios)(
    'rejects a direct forged tenant-A $label log carrying a tenant-B snapshot',
    async (scenario) => {
      const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
      const harness = makeHarness([target])
      const bus = new CommandBus()
      const { logEntry } = await bus.execute(scenario.commandId, {
        input: scenario.input,
        ctx: makeContext(harness, { isSuperAdmin: true }),
      })
      if (!logEntry) throw new Error('[internal] Expected an undoable action log')
      logEntry.tenantId = ACTOR_TENANT_ID
      const undoToken = String(logEntry.undoToken)
      harness.updateOrmEntity.mockClear()
      harness.deleteOrmEntity.mockClear()
      harness.em.findOne.mockClear()

      await expect(
        bus.undo(undoToken, makeContext(harness)),
      ).rejects.toMatchObject({ status: 404 })

      expect(harness.updateOrmEntity).not.toHaveBeenCalled()
      expect(harness.deleteOrmEntity).not.toHaveBeenCalled()
      expect(harness.em.findOne).not.toHaveBeenCalled()
      expect(harness.actionLogService.markUndone).not.toHaveBeenCalled()
      expect(harness.actionLogService.releaseUndoClaim).toHaveBeenCalledWith(logEntry.id)
    },
  )

  it.each(commandScenarios)(
    'allows a same-tenant command-bus undo and tenant-qualifies its $label target',
    async (scenario) => {
      const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
      const harness = makeHarness([target])
      const bus = new CommandBus()
      const ctx = makeContext(harness, { tenantId: FOREIGN_TENANT_ID })
      const { logEntry } = await bus.execute(scenario.commandId, {
        input: scenario.input,
        ctx,
      })
      expectTenantQualifiedFinalMutation(scenario, harness)
      harness.updateOrmEntity.mockClear()
      harness.em.findOne.mockClear()

      await bus.undo(String(logEntry?.undoToken), ctx)

      expectTenantQualifiedUndoTarget(scenario, harness)
      expect(harness.actionLogService.markUndone).toHaveBeenCalledWith(
        logEntry?.id,
        expect.objectContaining({ tenantId: FOREIGN_TENANT_ID }),
      )
    },
  )

  it.each(globalActorScenarios)(
    'keeps canonical $actorLabel foreign-target $label execute/log/undo behavior',
    async (scenario) => {
      const target = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID)
      const harness = makeHarness([target])
      const bus = new CommandBus()
      const ctx = makeContext(harness, scenario.actorOptions)
      const { logEntry } = await bus.execute(scenario.commandId, {
        input: scenario.input,
        ctx,
      })
      expectTenantQualifiedFinalMutation(scenario, harness)
      harness.updateOrmEntity.mockClear()
      harness.em.findOne.mockClear()

      await bus.undo(String(logEntry?.undoToken), ctx)

      expect(logEntry?.tenantId).toBe(FOREIGN_TENANT_ID)
      expectTenantQualifiedUndoTarget(scenario, harness)
      expect(harness.actionLogService.markUndone).toHaveBeenCalledWith(
        logEntry?.id,
        expect.objectContaining({ tenantId: FOREIGN_TENANT_ID }),
      )
    },
  )

  it('releases a real CommandBus undo claim when its tenant-qualified update target disappeared', async () => {
    const target = makeOrganization(TARGET_ID, ACTOR_TENANT_ID, { childIds: [CHILD_ID] })
    const child = makeOrganization(CHILD_ID, ACTOR_TENANT_ID, { parentId: TARGET_ID })
    const harness = makeHarness([target, child])
    const bus = new CommandBus()
    const ctx = makeContext(harness)
    primeChangedCustomFieldSnapshots()
    const { logEntry } = await bus.execute('directory.organizations.update', {
      input: { id: TARGET_ID, name: 'Updated before removal' },
      ctx,
    })
    if (!logEntry) throw new Error('[internal] Expected an undoable action log')
    harness.records.splice(harness.records.indexOf(target), 1)
    clearUndoObservationMocks(harness)

    await expect(bus.undo(String(logEntry.undoToken), ctx)).rejects.toMatchObject({ status: 404 })

    expect(harness.updateOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, tenant: ACTOR_TENANT_ID },
    }))
    expect(child.parentId).toBeNull()
    expectFailedUndoReleasedClaim(harness, logEntry)
  })

  it('does not mutate a colliding same-id foreign record when real CommandBus undo misses its tenant target', async () => {
    const target = makeOrganization(TARGET_ID, ACTOR_TENANT_ID, { name: 'Actor target' })
    const foreignCollision = makeOrganization(TARGET_ID, FOREIGN_TENANT_ID, { name: 'Foreign collision' })
    const harness = makeHarness([target, foreignCollision])
    const bus = new CommandBus()
    const ctx = makeContext(harness)
    primeChangedCustomFieldSnapshots()
    const { logEntry } = await bus.execute('directory.organizations.update', {
      input: { id: TARGET_ID, name: 'Updated actor target' },
      ctx,
    })
    if (!logEntry) throw new Error('[internal] Expected an undoable action log')
    harness.records.splice(harness.records.indexOf(target), 1)
    clearUndoObservationMocks(harness)

    await expect(bus.undo(String(logEntry.undoToken), ctx)).rejects.toMatchObject({ status: 404 })

    expect(harness.updateOrmEntity).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET_ID, tenant: ACTOR_TENANT_ID },
    }))
    expect(foreignCollision.name).toBe('Foreign collision')
    expect(foreignCollision.parentId).toBeNull()
    expectFailedUndoReleasedClaim(harness, logEntry)
  })
})
