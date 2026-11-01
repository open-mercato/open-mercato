/** @jest-environment node */
import type { AwilixContainer } from 'awilix'

const mockEmitCrudSideEffects = jest.fn()
const mockEmitCrudUndoSideEffects = jest.fn()
const mockEnsureFallback = jest.fn()
const mockTransactionLog: string[] = []

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: (...args: unknown[]) => mockEmitCrudSideEffects(...args),
    emitCrudUndoSideEffects: (...args: unknown[]) => mockEmitCrudUndoSideEffects(...args),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (
    em: { flush: () => Promise<void> },
    phases: (() => unknown)[],
    options?: { transaction?: boolean },
  ) => {
    if (options?.transaction) mockTransactionLog.push('begin')
    try {
      for (const phase of phases) await phase()
      await em.flush()
    } catch (err) {
      if (options?.transaction) mockTransactionLog.push('rollback')
      throw err
    }
    if (options?.transaction) mockTransactionLog.push('commit')
  },
}))

jest.mock('../../lib/support/seedDefaults', () => ({
  ensureFallbackProjectAndRule: (...args: unknown[]) => mockEnsureFallback(...args),
  resolveContainerProjectCodeGenerator: () => undefined,
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const RULE_ID = '55555555-5555-4555-8555-555555555555'

type Row = Record<string, unknown> & { id: string; deletedAt: Date | null }

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const operator = expected as { $in?: unknown[]; $ne?: unknown }
      if (operator.$in) return operator.$in.includes(actual)
      if ('$ne' in operator) return actual !== (operator.$ne ?? null)
    }
    if (expected === null) return actual === null
    return actual === expected
  })
}

function scoped(row: Record<string, unknown> & { id: string }): Row {
  return { tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null, updatedAt: new Date(0), ...row } as Row
}

function makeWorld(seed: { rules?: Row[]; projects?: Row[]; statuses?: Row[]; tasks?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    StaffSupportRoutingRule: seed.rules ?? [],
    StaffTimeProject: seed.projects ?? [],
    StaffTimeTaskStatus: seed.statuses ?? [],
    StaffTimeTask: seed.tasks ?? [],
  }
  const em: Record<string, unknown> = {
    flush: jest.fn(async () => undefined),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => (tables[cls.name] ?? []).filter((row) => matches(row, where))),
    findOne: jest.fn(async (cls: { name: string }, where: Record<string, unknown>, options?: { lockMode?: unknown }) => {
      mockTransactionLog.push(options?.lockMode !== undefined ? `lock:${cls.name}:${String(options.lockMode)}` : `findOne:${cls.name}`)
      return (tables[cls.name] ?? []).find((row) => matches(row, where)) ?? null
    }),
    nativeUpdate: jest.fn(async (cls: { name: string }, where: Record<string, unknown>, data: Record<string, unknown>) => {
      mockTransactionLog.push(`nativeUpdate:${cls.name}`)
      const affected = (tables[cls.name] ?? []).filter((row) => matches(row, where))
      for (const row of affected) Object.assign(row, data)
      return affected.length
    }),
    count: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      mockTransactionLog.push(`count:${cls.name}`)
      return (tables[cls.name] ?? []).filter((row) => matches(row, where)).length
    }),
  }
  em.fork = () => em
  const ctx = {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, roles: [], isSuperAdmin: false },
    selectedOrganizationId: ORG_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as unknown as AwilixContainer,
  }
  return { tables, ctx }
}

type Command = {
  prepare?: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  execute: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  buildLog: (args: { result?: unknown; snapshots?: unknown; ctx?: unknown }) => Promise<{ payload: unknown } | null>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

async function loadCommand(id: string): Promise<Command> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../support-routing-rules')
  return commandRegistry.get(id) as unknown as Command
}

function emittedEntityTypes(mock: jest.Mock): string[] {
  return mock.mock.calls.map(([params]) => (params as { indexer: { entityType: string } }).indexer.entityType)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTransactionLog.length = 0
})

describe('staff.support.routing_rules.create_fallback_project', () => {
  const input = { tenantId: TENANT_ID, organizationId: ORG_ID }

  it('emits project and rule side effects and logs an undoable entry when it creates', async () => {
    const { ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
    })
    mockEnsureFallback.mockResolvedValue({ ruleId: RULE_ID, timeProjectId: PROJECT_ID, created: true, taskStatusIds: ['s1', 's2'] })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')

    const result = await command.execute(input, ctx)

    expect(result).toEqual(expect.objectContaining({ created: true, ruleId: RULE_ID, timeProjectId: PROJECT_ID }))
    expect(emittedEntityTypes(mockEmitCrudSideEffects)).toEqual(['staff:staff_time_project', 'staff:staff_support_routing_rule'])
    const projectEmit = mockEmitCrudSideEffects.mock.calls[0][0] as { action: string; events: { module: string; entity: string } }
    expect(projectEmit.action).toBe('created')
    expect(projectEmit.events).toEqual(expect.objectContaining({ module: 'staff', entity: 'timesheets.time_project' }))

    const log = await command.buildLog({ result })
    expect(log?.payload).toEqual({
      undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: ['s1', 's2'], tenantId: TENANT_ID, organizationId: ORG_ID },
    })
  })

  it('reports the existing fallback without side effects or an audit entry when it did not create', async () => {
    const { ctx } = makeWorld()
    mockEnsureFallback.mockResolvedValue({ ruleId: RULE_ID, timeProjectId: PROJECT_ID, created: false, taskStatusIds: [] })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')

    const result = await command.execute(input, ctx)

    expect(result).toEqual(expect.objectContaining({ created: false, ruleId: RULE_ID }))
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
    await expect(command.buildLog({ result })).resolves.toBeNull()
  })

  it('undo soft-deletes only what the call created', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
      statuses: [
        scoped({ id: 's1', timeProjectId: PROJECT_ID }),
        scoped({ id: 's2', timeProjectId: PROJECT_ID }),
        scoped({ id: 's-added-later', timeProjectId: PROJECT_ID }),
      ],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: ['s1', 's2'], tenantId: TENANT_ID, organizationId: ORG_ID } }

    await command.undo({ logEntry: { commandPayload: payload }, ctx })

    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeInstanceOf(Date)
    expect(tables.StaffTimeProject[0].deletedAt).toBeInstanceOf(Date)
    expect(tables.StaffTimeTaskStatus.map((status) => status.deletedAt instanceof Date)).toEqual([true, true, false])
    expect(emittedEntityTypes(mockEmitCrudUndoSideEffects)).toEqual(['staff:staff_support_routing_rule', 'staff:staff_time_project'])
  })

  it('undo keeps a fallback rule that was re-pointed to another project since', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: 'another-project' })],
      projects: [scoped({ id: PROJECT_ID })],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: [], tenantId: TENANT_ID, organizationId: ORG_ID } }

    await command.undo({ logEntry: { commandPayload: payload }, ctx })

    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeNull()
    expect(tables.StaffTimeProject[0].deletedAt).toBeInstanceOf(Date)
  })

  it('undo keeps a fallback rule re-pointed after its reads and before its write', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
      statuses: [scoped({ id: 's1', timeProjectId: PROJECT_ID })],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: ['s1'], tenantId: TENANT_ID, organizationId: ORG_ID } }
    const em = ctx.container.resolve('em') as { find: jest.Mock; findOne: jest.Mock; nativeUpdate: jest.Mock }
    const originalFind = em.find.getMockImplementation()
    em.find.mockImplementationOnce(async (...args: unknown[]) => {
      const result = await originalFind!(...args)
      tables.StaffSupportRoutingRule[0].timeProjectId = 'another-project'
      return result
    })

    await command.undo({ logEntry: { commandPayload: payload }, ctx })

    const readsBeforeWrite = em.findOne.mock.invocationCallOrder.filter((order) => order < em.nativeUpdate.mock.invocationCallOrder[0])
    expect(readsBeforeWrite.length).toBeGreaterThan(0)
    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeNull()
    expect(tables.StaffSupportRoutingRule[0].timeProjectId).toBe('another-project')
    expect(tables.StaffTimeProject[0].deletedAt).toBeInstanceOf(Date)
    expect(tables.StaffTimeTaskStatus[0].deletedAt).toBeInstanceOf(Date)
    expect(emittedEntityTypes(mockEmitCrudUndoSideEffects)).toEqual(['staff:staff_time_project'])
  })

  it('undo removes the rule with one conditional write scoped to its original target', async () => {
    const { ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: [], tenantId: TENANT_ID, organizationId: ORG_ID } }
    const em = ctx.container.resolve('em') as { nativeUpdate: jest.Mock }

    await command.undo({ logEntry: { commandPayload: payload }, ctx })

    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    const [cls, where, data] = em.nativeUpdate.mock.calls[0] as [{ name: string }, Record<string, unknown>, Record<string, unknown>]
    expect(cls.name).toBe('StaffSupportRoutingRule')
    expect(where).toEqual({ id: RULE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: PROJECT_ID, deletedAt: null })
    expect(data.deletedAt).toBeInstanceOf(Date)
    expect(mockTransactionLog.indexOf('nativeUpdate:StaffSupportRoutingRule')).toBeGreaterThan(mockTransactionLog.indexOf('count:StaffTimeTask'))
  })

  it('undo refuses and changes nothing once tasks were filed in the project', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
      statuses: [scoped({ id: 's1', timeProjectId: PROJECT_ID })],
      tasks: [scoped({ id: 'task-1', timeProjectId: PROJECT_ID })],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: ['s1'], tenantId: TENANT_ID, organizationId: ORG_ID } }

    const error = (await command.undo({ logEntry: { commandPayload: payload }, ctx }).then(() => null, (err: unknown) => err)) as {
      status?: number
      body?: { code?: string }
    } | null

    expect(error?.status).toBe(409)
    expect(error?.body?.code).toBe('support_fallback_project_in_use')
    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeNull()
    expect(tables.StaffTimeProject[0].deletedAt).toBeNull()
    expect(tables.StaffTimeTaskStatus[0].deletedAt).toBeNull()
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('undo locks the project row and counts live tasks inside the same transaction', async () => {
    const { LockMode } = jest.requireActual('@mikro-orm/core') as typeof import('@mikro-orm/core')
    const { ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: [], tenantId: TENANT_ID, organizationId: ORG_ID } }

    await command.undo({ logEntry: { commandPayload: payload }, ctx })

    const lockEntry = `lock:StaffTimeProject:${String(LockMode.PESSIMISTIC_WRITE)}`
    expect(mockTransactionLog[0]).toBe('begin')
    expect(mockTransactionLog[1]).toBe(lockEntry)
    expect(mockTransactionLog[2]).toBe('count:StaffTimeTask')
    expect(mockTransactionLog[mockTransactionLog.length - 1]).toBe('commit')
  })

  it('undo refuses inside the locked transaction when intake committed a ticket first', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: [], tenantId: TENANT_ID, organizationId: ORG_ID } }
    const originalFindOne = (ctx.container.resolve('em') as { findOne: jest.Mock }).findOne.getMockImplementation()
    ;(ctx.container.resolve('em') as { findOne: jest.Mock }).findOne.mockImplementationOnce(async (...args: unknown[]) => {
      tables.StaffTimeTask.push(scoped({ id: 'task-committed-by-intake', timeProjectId: PROJECT_ID }))
      return originalFindOne!(...args)
    })

    const error = (await command.undo({ logEntry: { commandPayload: payload }, ctx }).then(() => null, (err: unknown) => err)) as {
      status?: number
      body?: { code?: string }
    } | null

    expect(error?.status).toBe(409)
    expect(error?.body?.code).toBe('support_fallback_project_in_use')
    expect(mockTransactionLog).toContain('rollback')
    expect(mockTransactionLog).not.toContain('commit')
    expect(tables.StaffTimeProject[0].deletedAt).toBeNull()
    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeNull()
  })

  it('undo ignores tasks that were deleted since', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID })],
      tasks: [scoped({ id: 'task-1', timeProjectId: PROJECT_ID, deletedAt: new Date() })],
    })
    const command = await loadCommand('staff.support.routing_rules.create_fallback_project')
    const payload = { undo: { ruleId: RULE_ID, timeProjectId: PROJECT_ID, taskStatusIds: [], tenantId: TENANT_ID, organizationId: ORG_ID } }

    await command.undo({ logEntry: { commandPayload: payload }, ctx })

    expect(tables.StaffTimeProject[0].deletedAt).toBeInstanceOf(Date)
  })
})

describe('staff.support.routing_rules.update', () => {
  const OTHER_PROJECT_ID = '66666666-6666-4666-8666-666666666666'

  function repointWorld() {
    return makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: null, timeProjectId: PROJECT_ID })],
      projects: [scoped({ id: PROJECT_ID }), scoped({ id: OTHER_PROJECT_ID })],
      statuses: [scoped({ id: 's-other', timeProjectId: OTHER_PROJECT_ID, isDefault: true })],
    })
  }

  it('locks the target project before the rule, the same order as the fallback undo', async () => {
    const { LockMode } = jest.requireActual('@mikro-orm/core') as typeof import('@mikro-orm/core')
    const { tables, ctx } = repointWorld()
    const command = await loadCommand('staff.support.routing_rules.update')

    await command.execute({ id: RULE_ID, timeProjectId: OTHER_PROJECT_ID }, ctx)

    expect(tables.StaffSupportRoutingRule[0].timeProjectId).toBe(OTHER_PROJECT_ID)
    const transaction = mockTransactionLog.slice(mockTransactionLog.indexOf('begin'))
    const projectLock = transaction.indexOf(`lock:StaffTimeProject:${String(LockMode.PESSIMISTIC_READ)}`)
    const ruleLock = transaction.indexOf(`lock:StaffSupportRoutingRule:${String(LockMode.PESSIMISTIC_WRITE)}`)
    expect(projectLock).toBe(1)
    expect(ruleLock).toBeGreaterThan(projectLock)
  })

  it('locks the requested project even when the rule already targets it', async () => {
    const { LockMode } = jest.requireActual('@mikro-orm/core') as typeof import('@mikro-orm/core')
    const { ctx } = repointWorld()
    const command = await loadCommand('staff.support.routing_rules.update')

    await command.execute({ id: RULE_ID, timeProjectId: PROJECT_ID }, ctx)

    const transaction = mockTransactionLog.slice(mockTransactionLog.indexOf('begin'))
    const projectLock = transaction.indexOf(`lock:StaffTimeProject:${String(LockMode.PESSIMISTIC_READ)}`)
    const ruleLock = transaction.indexOf(`lock:StaffSupportRoutingRule:${String(LockMode.PESSIMISTIC_WRITE)}`)
    expect(projectLock).toBe(1)
    expect(ruleLock).toBeGreaterThan(projectLock)
  })

  it('refuses an update to the current target once that project was deleted after the first read', async () => {
    const { tables, ctx } = repointWorld()
    const command = await loadCommand('staff.support.routing_rules.update')
    const em = ctx.container.resolve('em') as { findOne: jest.Mock }
    const originalFindOne = em.findOne.getMockImplementation()
    em.findOne.mockImplementationOnce(async (...args: unknown[]) => {
      const found = await originalFindOne!(...args)
      tables.StaffSupportRoutingRule[0].timeProjectId = OTHER_PROJECT_ID
      tables.StaffTimeProject[0].deletedAt = new Date()
      return found
    })

    const error = (await command
      .execute({ id: RULE_ID, timeProjectId: PROJECT_ID }, ctx)
      .then(() => null, (err: unknown) => err)) as { status?: number; body?: { code?: string } } | null

    expect(error?.status).toBe(422)
    expect(error?.body?.code).toBe('support_project_not_found')
    expect(tables.StaffSupportRoutingRule[0].timeProjectId).toBe(OTHER_PROJECT_ID)
  })

  it('undo locks the restored project and then the live rule, even when the target is unchanged', async () => {
    const { LockMode } = jest.requireActual('@mikro-orm/core') as typeof import('@mikro-orm/core')
    const { tables, ctx } = repointWorld()
    const command = await loadCommand('staff.support.routing_rules.update')
    const before = { id: RULE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, categoryValue: null, timeProjectId: PROJECT_ID, isActive: true, deletedAt: null }

    await command.undo({ logEntry: { commandPayload: { undo: { before } } }, ctx })

    const transaction = mockTransactionLog.slice(mockTransactionLog.indexOf('begin'))
    const projectLock = transaction.indexOf(`lock:StaffTimeProject:${String(LockMode.PESSIMISTIC_READ)}`)
    const ruleLock = transaction.indexOf(`lock:StaffSupportRoutingRule:${String(LockMode.PESSIMISTIC_WRITE)}`)
    expect(projectLock).toBe(1)
    expect(ruleLock).toBeGreaterThan(projectLock)
    expect(tables.StaffSupportRoutingRule[0].timeProjectId).toBe(PROJECT_ID)
  })

  it('refuses to repoint at a project a concurrent undo deleted, leaving the rule untouched', async () => {
    const { LockMode } = jest.requireActual('@mikro-orm/core') as typeof import('@mikro-orm/core')
    const { tables, ctx } = repointWorld()
    tables.StaffTimeProject[1].deletedAt = new Date()
    const command = await loadCommand('staff.support.routing_rules.update')

    const error = (await command
      .execute({ id: RULE_ID, timeProjectId: OTHER_PROJECT_ID }, ctx)
      .then(() => null, (err: unknown) => err)) as { status?: number; body?: { code?: string } } | null

    expect(error?.status).toBe(422)
    expect(error?.body?.code).toBe('support_project_not_found')
    expect(mockTransactionLog).not.toContain(`lock:StaffSupportRoutingRule:${String(LockMode.PESSIMISTIC_WRITE)}`)
    expect(tables.StaffSupportRoutingRule[0].timeProjectId).toBe(PROJECT_ID)
  })

  it('undo refuses to point the rule back at a project deleted since, under the shared project lock', async () => {
    const { LockMode } = jest.requireActual('@mikro-orm/core') as typeof import('@mikro-orm/core')
    const { tables, ctx } = repointWorld()
    tables.StaffSupportRoutingRule[0].timeProjectId = OTHER_PROJECT_ID
    tables.StaffTimeProject[0].deletedAt = new Date()
    const command = await loadCommand('staff.support.routing_rules.update')
    const before = { id: RULE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, categoryValue: null, timeProjectId: PROJECT_ID, isActive: true, deletedAt: null }

    const error = (await command
      .undo({ logEntry: { commandPayload: { undo: { before } } }, ctx })
      .then(() => null, (err: unknown) => err)) as { status?: number } | null

    expect(error?.status).toBe(422)
    expect(mockTransactionLog).toContain(`lock:StaffTimeProject:${String(LockMode.PESSIMISTIC_READ)}`)
    expect(tables.StaffSupportRoutingRule[0].timeProjectId).toBe(OTHER_PROJECT_ID)
  })

  it('refuses instead of repointing a rule a concurrent undo deleted after the first read', async () => {
    const { tables, ctx } = repointWorld()
    const command = await loadCommand('staff.support.routing_rules.update')
    const em = ctx.container.resolve('em') as { findOne: jest.Mock }
    const originalFindOne = em.findOne.getMockImplementation()
    em.findOne.mockImplementationOnce(async (...args: unknown[]) => {
      const found = await originalFindOne!(...args)
      tables.StaffSupportRoutingRule[0].deletedAt = new Date()
      return found
    })

    const error = (await command
      .execute({ id: RULE_ID, timeProjectId: OTHER_PROJECT_ID }, ctx)
      .then(() => null, (err: unknown) => err)) as { status?: number } | null

    expect(error?.status).toBe(404)
    expect(mockTransactionLog).toContain('rollback')
    expect(tables.StaffSupportRoutingRule[0].timeProjectId).toBe(PROJECT_ID)
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })
})

describe('staff.support.routing_rules.delete undo', () => {
  const before = {
    id: RULE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    categoryValue: 'billing',
    timeProjectId: PROJECT_ID,
    isActive: true,
    deletedAt: null,
  }

  it('restores the rule when its category is free', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: 'billing', timeProjectId: PROJECT_ID, deletedAt: new Date() })],
      projects: [scoped({ id: PROJECT_ID })],
      statuses: [scoped({ id: 's1', timeProjectId: PROJECT_ID, isDefault: true })],
    })
    const command = await loadCommand('staff.support.routing_rules.delete')

    await command.undo({ logEntry: { commandPayload: { undo: { before } } }, ctx })

    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeNull()
    expect(mockEmitCrudUndoSideEffects).toHaveBeenCalledTimes(1)
  })

  it('fails with a mapped 409 when a newer rule now owns the category', async () => {
    const { tables, ctx } = makeWorld({
      rules: [
        scoped({ id: RULE_ID, categoryValue: 'billing', timeProjectId: PROJECT_ID, deletedAt: new Date() }),
        scoped({ id: 'newer-rule', categoryValue: 'billing', timeProjectId: 'other-project' }),
      ],
      projects: [scoped({ id: PROJECT_ID })],
      statuses: [scoped({ id: 's1', timeProjectId: PROJECT_ID, isDefault: true })],
    })
    const command = await loadCommand('staff.support.routing_rules.delete')

    const error = (await command
      .undo({ logEntry: { commandPayload: { undo: { before } } }, ctx })
      .then(() => null, (err: unknown) => err)) as { status?: number; body?: { code?: string } } | null

    expect(error?.status).toBe(409)
    expect(error?.body?.code).toBe('support_routing_rule_duplicate')
    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeInstanceOf(Date)
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })
})

describe('staff.support.routing_rules.delete undo against a deleted project', () => {
  it('refuses to restore a rule onto a project that is gone', async () => {
    const { tables, ctx } = makeWorld({
      rules: [scoped({ id: RULE_ID, categoryValue: 'billing', timeProjectId: PROJECT_ID, deletedAt: new Date() })],
      projects: [scoped({ id: PROJECT_ID, deletedAt: new Date() })],
    })
    const command = await loadCommand('staff.support.routing_rules.delete')
    const before = { id: RULE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, categoryValue: 'billing', timeProjectId: PROJECT_ID, isActive: true, deletedAt: null }

    const error = (await command
      .undo({ logEntry: { commandPayload: { undo: { before } } }, ctx })
      .then(() => null, (err: unknown) => err)) as { status?: number; body?: { code?: string } } | null

    expect(error?.status).toBe(422)
    expect(error?.body?.code).toBe('support_project_not_found')
    expect(tables.StaffSupportRoutingRule[0].deletedAt).toBeInstanceOf(Date)
  })
})
