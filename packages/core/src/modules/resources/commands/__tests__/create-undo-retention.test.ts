/** @jest-environment node */

import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects, emitCrudUndoSideEffects, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ResourcesResource, ResourcesResourceActivity, ResourcesResourceComment } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
    setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (
    em: { findOne: (entity: unknown, where: Record<string, unknown>) => Promise<unknown> },
    entity: unknown,
    where: Record<string, unknown>,
  ) => em.findOne(entity, where)),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHILD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const AUTHOR_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const OTHER_SCOPE_ID = '11111111-1111-4111-8111-111111111111'
const CREATED_AT = '2026-01-02T03:04:05.000Z'
const OCCURRED_AT = '2026-02-03T04:05:06.000Z'

const cases = [
  {
    kind: 'comment',
    commandId: 'resources.resource-comments.create',
    entityClass: ResourcesResourceComment,
    entityType: 'resources:resources_resource_comment',
    resultKey: 'commentId',
  },
  {
    kind: 'activity',
    commandId: 'resources.resource-activities.create',
    entityClass: ResourcesResourceActivity,
    entityType: 'resources:resources_resource_activity',
    resultKey: 'activityId',
  },
] as const

type ResourceCase = (typeof cases)[number]
type FakeResource = { id: string; tenantId: string; organizationId: string }
type FakeChild = FakeResource & {
  resource: FakeResource
  body: string
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  activityType?: string
  subject?: string
  occurredAt?: Date | null
}

function buildFixture(scenario: ResourceCase, rowExists = true) {
  const resource: FakeResource = {
    id: RESOURCE_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
  }
  const child: FakeChild = {
    id: CHILD_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    resource,
    body: 'Retained timeline body',
    authorUserId: AUTHOR_ID,
    appearanceIcon: 'lucide:clipboard',
    appearanceColor: null,
    createdAt: new Date(CREATED_AT),
    updatedAt: new Date(CREATED_AT),
    deletedAt: null,
    ...(scenario.kind === 'activity'
      ? { activityType: 'inspection', subject: 'Original inspection', occurredAt: new Date(OCCURRED_AT) }
      : {}),
  }
  let stored: FakeChild | null = rowExists ? child : null
  const em = {
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    findOne: jest.fn(async (entity: unknown, where?: Record<string, unknown>) => {
      if (Object.values(where ?? {}).includes(undefined)) return null
      if (entity === ResourcesResource) return resource
      if (entity === scenario.entityClass) {
        if (where?.deletedAt === null && stored?.deletedAt) return null
        return stored
      }
      return null
    }),
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => {
      stored = { ...child, ...values } as FakeChild
      return stored
    }),
  }
  const dataEngine = {}
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'dataEngine') return dataEngine
        return {}
      }),
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: AUTHOR_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
  const snapshot = {
    id: child.id,
    tenantId: child.tenantId,
    organizationId: child.organizationId,
    resourceId: resource.id,
    body: child.body,
    authorUserId: child.authorUserId,
    appearanceIcon: child.appearanceIcon,
    appearanceColor: child.appearanceColor,
    ...(scenario.kind === 'activity'
      ? { activityType: child.activityType, subject: child.subject, occurredAt: OCCURRED_AT }
      : {}),
  }
  const after = scenario.kind === 'activity'
    ? { activity: snapshot, custom: { inspection_result: 'passed', inspectors: ['first', 'second'] } }
    : snapshot
  const logEntry: CommandUndoLogEntry = JSON.parse(JSON.stringify({
    id: 'create-action-log',
    resourceId: CHILD_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    commandPayload: { undo: { after } },
    snapshotAfter: after,
  })) as CommandUndoLogEntry
  return { child, resource, em, ctx, dataEngine, logEntry }
}

beforeAll(async () => {
  commandRegistry.clear()
  await import('../comments')
  await import('../activities')
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe.each(cases)('resources $kind create undo row retention (#7667)', (scenario) => {
  function command() {
    const handler = commandRegistry.get<unknown, Record<string, unknown>>(scenario.commandId)
    if (!handler?.undo || !handler.redo) throw new Error('[internal] Resource create replay handler missing')
    return { undo: handler.undo, redo: handler.redo }
  }

  it('retains the original row, creation time, author, parent, and content when undo marks it deleted', async () => {
    const fixture = buildFixture(scenario)
    const before = { ...fixture.child }

    await command().undo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })

    expect(fixture.child.deletedAt).toBeInstanceOf(Date)
    expect(fixture.child).toMatchObject({
      ...before,
      deletedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    expect(fixture.child.resource).toBe(fixture.resource)
    expect(fixture.em.remove).not.toHaveBeenCalled()
    expect(fixture.em.create).not.toHaveBeenCalled()
    expect(fixture.em.flush).toHaveBeenCalledTimes(1)
    expect(emitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({
      dataEngine: fixture.dataEngine,
      action: 'deleted',
      entity: fixture.child,
      identifiers: { id: CHILD_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      indexer: expect.objectContaining({ entityType: scenario.entityType }),
    }))
    expect(fixture.em.flush.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(emitCrudUndoSideEffects).mock.invocationCallOrder[0])
  })

  it('undoes creation in the all-organizations selection without querying a null organization', async () => {
    const fixture = buildFixture(scenario)
    fixture.ctx.selectedOrganizationId = null
    fixture.ctx.organizationIds = [ORGANIZATION_ID, OTHER_SCOPE_ID]
    fixture.ctx.organizationScope = {
      selectedId: null,
      filterIds: [ORGANIZATION_ID, OTHER_SCOPE_ID],
      allowedIds: [ORGANIZATION_ID, OTHER_SCOPE_ID],
      tenantId: TENANT_ID,
    }

    await command().undo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })

    expect(fixture.child.deletedAt).toBeInstanceOf(Date)
    expect(fixture.em.findOne).toHaveBeenCalledWith(scenario.entityClass, {
      id: CHILD_ID,
      tenantId: TENANT_ID,
    })
    expect(fixture.em.flush).toHaveBeenCalledTimes(1)
    expect(emitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deleted',
      identifiers: { id: CHILD_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    }))
  })

  it('undoes creation from a tenant-less system context without querying a null tenant', async () => {
    const fixture = buildFixture(scenario)
    fixture.ctx.auth = null

    await command().undo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })

    expect(fixture.child.deletedAt).toBeInstanceOf(Date)
    expect(fixture.em.findOne).toHaveBeenCalledWith(scenario.entityClass, {
      id: CHILD_ID,
      organizationId: ORGANIZATION_ID,
    })
    expect(fixture.em.flush).toHaveBeenCalledTimes(1)
    expect(emitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deleted',
      identifiers: { id: CHILD_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    }))
  })

  it('revives the retained row with the same ID and original timestamps', async () => {
    const fixture = buildFixture(scenario)
    fixture.child.deletedAt = new Date('2026-03-01T00:00:00.000Z')

    const result = await command().redo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })

    expect(result).toMatchObject({ [scenario.resultKey]: CHILD_ID, authorUserId: AUTHOR_ID })
    expect(fixture.child.deletedAt).toBeNull()
    expect(fixture.child.createdAt.toISOString()).toBe(CREATED_AT)
    expect(fixture.child.body).toBe('Retained timeline body')
    expect(fixture.child.resource).toBe(fixture.resource)
    expect(fixture.em.create).not.toHaveBeenCalled()
    expect(fixture.em.persist).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).toHaveBeenCalledWith(expect.objectContaining({
      action: 'created',
      entity: fixture.child,
      identifiers: { id: CHILD_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      indexer: expect.objectContaining({ entityType: scenario.entityType }),
    }))
    if (scenario.kind === 'activity') {
      expect(fixture.child.occurredAt).toBeInstanceOf(Date)
      expect(fixture.child.occurredAt?.toISOString()).toBe(OCCURRED_AT)
      expect(setCustomFieldsIfAny).toHaveBeenCalledWith(expect.objectContaining({
        entityId: scenario.entityType,
        recordId: CHILD_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        values: { inspection_result: 'passed', inspectors: ['first', 'second'] },
        notify: false,
      }))
    }
  })

  it.each(['update', 'delete'] as const)('rejects ordinary %s after creation undo and permits it after redo', async (action) => {
    const fixture = buildFixture(scenario)
    await command().undo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })
    const hiddenRow = { ...fixture.child }
    jest.clearAllMocks()
    const handler = commandRegistry.get<unknown, unknown>(scenario.commandId.replace('.create', `.${action}`))
    if (!handler) throw new Error('[internal] Resource mutation handler missing')
    const input = action === 'update'
      ? { id: CHILD_ID, body: 'Changed after redo' }
      : { query: { id: CHILD_ID } }

    await expect(handler.execute(input, fixture.ctx)).rejects.toMatchObject({ status: 404 })

    expect(fixture.em.findOne).toHaveBeenCalledWith(scenario.entityClass, { id: CHILD_ID, deletedAt: null })
    expect(fixture.child).toEqual(hiddenRow)
    expect(fixture.em.remove).not.toHaveBeenCalled()
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()

    await command().redo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })
    expect(fixture.child.deletedAt).toBeNull()
    expect(fixture.em.create).not.toHaveBeenCalled()
    jest.clearAllMocks()

    await expect(handler.execute(input, fixture.ctx)).resolves.toMatchObject({ [scenario.resultKey]: CHILD_ID })
    expect(fixture.em.flush).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: action === 'update' ? 'updated' : 'deleted' }))
    if (action === 'update') expect(fixture.child.body).toBe('Changed after redo')
    else expect(fixture.em.remove).toHaveBeenCalledWith(fixture.child)
  })

  it.each(['tenantId', 'organizationId'] as const)('rejects undo of a row outside the caller %s', async (scopeField) => {
    const fixture = buildFixture(scenario)
    fixture.child[scopeField] = OTHER_SCOPE_ID

    await expect(command().undo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })).rejects.toBeInstanceOf(CrudHttpError)

    expect(fixture.child.deletedAt).toBeNull()
    expect(fixture.em.remove).not.toHaveBeenCalled()
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it.each(['tenantId', 'organizationId'] as const)('rejects redo when the snapshot is outside the caller %s', async (scopeField) => {
    const fixture = buildFixture(scenario, false)
    if (scopeField === 'tenantId') fixture.ctx.auth = { ...fixture.ctx.auth!, tenantId: OTHER_SCOPE_ID }
    else fixture.ctx.selectedOrganizationId = OTHER_SCOPE_ID

    await expect(command().redo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })).rejects.toBeInstanceOf(CrudHttpError)

    expect(fixture.em.create).not.toHaveBeenCalled()
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  })

  it.each(['tenantId', 'organizationId'] as const)('rejects redo of a retained row outside the caller %s', async (scopeField) => {
    const fixture = buildFixture(scenario)
    fixture.child[scopeField] = OTHER_SCOPE_ID
    fixture.child.deletedAt = new Date('2026-03-01T00:00:00.000Z')

    await expect(command().redo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })).rejects.toBeInstanceOf(CrudHttpError)

    expect(fixture.child.deletedAt).toEqual(new Date('2026-03-01T00:00:00.000Z'))
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it.each(['tenantId', 'organizationId'] as const)('rejects redo with a parent outside the caller %s', async (scopeField) => {
    const fixture = buildFixture(scenario, false)
    fixture.resource[scopeField] = OTHER_SCOPE_ID

    await expect(command().redo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })).rejects.toBeInstanceOf(CrudHttpError)

    expect(fixture.em.create).not.toHaveBeenCalled()
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('does not publish a deletion when the database flush fails', async () => {
    const fixture = buildFixture(scenario)
    const error = new Error('[internal] Fixture flush failure')
    fixture.em.flush.mockRejectedValueOnce(error)

    await expect(command().undo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })).rejects.toBe(error)

    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('tolerates historical create undo when the child row has already been removed', async () => {
    const fixture = buildFixture(scenario, false)

    await command().undo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })

    expect(fixture.em.create).not.toHaveBeenCalled()
    expect(fixture.em.remove).not.toHaveBeenCalled()
    expect(fixture.em.flush).not.toHaveBeenCalled()
    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it.each(['commandPayload', 'snapshotAfter', 'nullAfter'] as const)('recreates a historical hard-deleted row from %s without timestamp fields', async (snapshotLocation) => {
    const fixture = buildFixture(scenario, false)
    if (snapshotLocation === 'snapshotAfter') delete fixture.logEntry.commandPayload
    else if (snapshotLocation === 'commandPayload') delete fixture.logEntry.snapshotAfter
    else fixture.logEntry.commandPayload = { undo: { after: null } }

    const result = await command().redo({ input: {}, ctx: fixture.ctx, logEntry: fixture.logEntry })

    expect(result).toMatchObject({ [scenario.resultKey]: CHILD_ID, authorUserId: AUTHOR_ID })
    expect(fixture.em.create).toHaveBeenCalledWith(scenario.entityClass, expect.objectContaining({
      id: CHILD_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      body: 'Retained timeline body',
      authorUserId: AUTHOR_ID,
      resource: fixture.resource,
    }))
    expect(fixture.em.persist).toHaveBeenCalledTimes(1)
    const restored = await fixture.em.findOne(scenario.entityClass)
    expect(restored).toMatchObject({ id: CHILD_ID, deletedAt: null })
    if (scenario.kind === 'activity') {
      expect(restored).toMatchObject({ occurredAt: new Date(OCCURRED_AT) })
    }
  })
})
