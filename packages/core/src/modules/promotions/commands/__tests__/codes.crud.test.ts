// Release 4 PLAN.md Step 6.4 — unit coverage for `commands/codes.ts`'s Code CRUD commands
// (`promotions.code.{create,update,delete}`), the piece Step 6.2 left unbuilt (it only
// covered `reserve`/`release`/`use`). Same hand-built, in-memory fake `EntityManager`
// style as `lib/__tests__/code-service.test.ts` — `withAtomicFlush`'s transaction path
// (begin/commit/rollback/isInTransaction) is already proven against this exact fake shape
// by that suite's `useCode` coverage.

import { randomUUID } from 'crypto'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { Code, GeneratedCode } from '../../data/entities'
import { createCodeCommand, updateCodeCommand, deleteCodeCommand } from '../codes'
import { resolveCodeByString } from '../../lib/code-service'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

const TENANT = 'tenant-1'
const ORG = 'org-1'

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Row
      if ('$in' in cond) return Array.isArray(cond.$in) && (cond.$in as unknown[]).includes(value)
    }
    if (condition === null) return value === null || value === undefined
    return value === condition
  })
}

type FakeEm = {
  findOne: (entity: Function, where: Row) => Promise<Row | null>
  find: (entity: Function, where: Row) => Promise<Row[]>
  create: (entity: Function, data: Row) => Row
  persist: (row: Row) => void
  remove: (row: Row) => void
  flush: () => Promise<void>
  nativeUpdate: (entity: Function, where: Row, data: Row) => Promise<number>
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  isInTransaction: () => boolean
  fork: () => FakeEm
}

function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]> } {
  const tables = new Map<Function, Row[]>()
  let inTransaction = false
  let pendingCreates: Array<{ entity: Function; row: Row }> = []
  let pendingRemovals: Array<{ entity: Function; row: Row }> = []

  function tableFor(entity: Function): Row[] {
    let rows = tables.get(entity)
    if (!rows) {
      rows = []
      tables.set(entity, rows)
    }
    return rows
  }

  const em: FakeEm = {
    findOne: async (entity, where) => tableFor(entity).find((row) => matchesWhere(row, where)) ?? null,
    find: async (entity, where) => tableFor(entity).filter((row) => matchesWhere(row, where)),
    create: (entity, data) => {
      const row: Row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data }
      pendingCreates.push({ entity, row })
      return row
    },
    persist: () => {},
    remove: (row) => {
      for (const rows of tables.values()) {
        const idx = rows.indexOf(row)
        if (idx >= 0) {
          pendingRemovals.push({ entity: [...tables.entries()].find(([, v]) => v === rows)![0], row })
        }
      }
    },
    flush: async () => {
      const toApply = pendingCreates
      pendingCreates = []
      for (const { entity, row } of toApply) tableFor(entity).push(row)
      const toRemove = pendingRemovals
      pendingRemovals = []
      for (const { entity, row } of toRemove) {
        const rows = tableFor(entity)
        const idx = rows.indexOf(row)
        if (idx >= 0) rows.splice(idx, 1)
      }
    },
    nativeUpdate: async (entity, where, data) => {
      const rows = tableFor(entity).filter((row) => matchesWhere(row, where))
      for (const row of rows) Object.assign(row, data)
      return rows.length
    },
    begin: async () => {
      inTransaction = true
    },
    commit: async () => {
      inTransaction = false
    },
    rollback: async () => {
      inTransaction = false
    },
    isInTransaction: () => inTransaction,
    fork: () => em,
  }
  return { em, tables }
}

function seedCode(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Test code',
    type: 'static',
    code: 'SAVE10',
    prefix: null,
    suffix: null,
    length: null,
    amount: null,
    generated: 0,
    used: 0,
    usage: 'unlimited',
    usageAmount: null,
    usagePerCustomer: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
  const rows = tables.get(Code) ?? []
  rows.push(row)
  tables.set(Code, rows)
  return row
}

function seedGeneratedCode(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organizationId: ORG,
    tenantId: TENANT,
    code: `GEN-${randomUUID().slice(0, 8)}`,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
  const rows = tables.get(GeneratedCode) ?? []
  rows.push(row)
  tables.set(GeneratedCode, rows)
  return row
}

type FakeResolve = {
  dataEngine: { markOrmEntityChange: jest.Mock }
  promotionCodeGenerationService?: { triggerGeneration: jest.Mock }
}

function fakeCtx(em: FakeEm, resolve: FakeResolve, authOverrides: Partial<{ tenantId: string | null; orgId: string | null }> = {}): CommandRuntimeContext {
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return resolve.dataEngine
      if (name === 'promotionCodeGenerationService') {
        if (!resolve.promotionCodeGenerationService) throw new Error('[internal] not registered: promotionCodeGenerationService')
        return resolve.promotionCodeGenerationService
      }
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false, ...authOverrides } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: null,
    transactionalEm: undefined,
  }
}

function fakeDataEngine() {
  return { markOrmEntityChange: jest.fn() }
}

describe('promotions.code.create command', () => {
  it('creates a static code and does not trigger generation', async () => {
    const { em } = createFakeEm()
    const dataEngine = fakeDataEngine()
    const triggerGeneration = jest.fn(async () => ({ jobId: 'job-1' }))
    const ctx = fakeCtx(em, { dataEngine, promotionCodeGenerationService: { triggerGeneration } })

    const result = await createCodeCommand.execute(
      { name: 'Launch promo', type: 'static', code: 'LAUNCH10', usage: 'unlimited', active: true } as any,
      ctx,
    )

    expect(result.codeId).toBeDefined()
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created' }))
    expect(triggerGeneration).not.toHaveBeenCalled()
  })

  it('creates a dynamic code and triggers generation with the new codeId and actor scope', async () => {
    const { em } = createFakeEm()
    const dataEngine = fakeDataEngine()
    const triggerGeneration = jest.fn(async () => ({ jobId: 'job-1' }))
    const ctx = fakeCtx(em, { dataEngine, promotionCodeGenerationService: { triggerGeneration } })

    const result = await createCodeCommand.execute(
      { name: 'Dynamic pool', type: 'dynamic', amount: 100, length: 8, usage: 'unlimited', active: true } as any,
      ctx,
    )

    expect(triggerGeneration).toHaveBeenCalledWith(result.codeId, { tenantId: TENANT, organizationId: ORG })
  })

  it('does not fail the create when triggering generation throws', async () => {
    const { em } = createFakeEm()
    const dataEngine = fakeDataEngine()
    const triggerGeneration = jest.fn(async () => {
      throw new Error('queue unreachable')
    })
    const ctx = fakeCtx(em, { dataEngine, promotionCodeGenerationService: { triggerGeneration } })

    const result = await createCodeCommand.execute(
      { name: 'Dynamic pool', type: 'dynamic', amount: 100, length: 8, usage: 'unlimited', active: true } as any,
      ctx,
    )

    expect(result.codeId).toBeDefined()
  })

  it('fails closed with 400 when the actor carries no tenant/organization scope', async () => {
    const { em } = createFakeEm()
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine }, { tenantId: null, orgId: null })

    await expect(
      createCodeCommand.execute({ name: 'X', type: 'static', code: 'X', usage: 'unlimited', active: true } as any, ctx),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('stores a lowercase-typed code upper-cased and resolves it by either casing (QA F9 live repro, end-to-end)', async () => {
    const { em, tables } = createFakeEm()
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine })

    const result = await createCodeCommand.execute(
      { name: 'Summer promo', type: 'static', code: 'summer10', usage: 'unlimited', active: true } as any,
      ctx,
    )

    const stored = tables.get(Code)!.find((row) => row.id === result.codeId)
    expect(stored?.code).toBe('SUMMER10')

    const scope = { tenantId: TENANT, organizationId: ORG }
    const resolvedLower = await resolveCodeByString(em as unknown as import('@mikro-orm/postgresql').EntityManager, 'summer10', scope)
    const resolvedUpper = await resolveCodeByString(em as unknown as import('@mikro-orm/postgresql').EntityManager, 'SUMMER10', scope)

    expect(resolvedLower?.code.id).toBe(result.codeId)
    expect(resolvedUpper?.code.id).toBe(result.codeId)
  })
})

describe('promotions.code.update command', () => {
  it('updates fields and emits an updated side effect', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { name: 'Old name', active: true })
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine })

    const result = await updateCodeCommand.execute({ id: code.id, name: 'New name', active: false } as any, ctx)

    expect(result.codeId).toBe(code.id)
    expect(code.name).toBe('New name')
    expect(code.active).toBe(false)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated' }))
  })

  it('answers a cross-tenant code as not-found (404), never a 403 existence oracle', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { tenantId: 'other-tenant' })
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine })

    expect.assertions(2)
    try {
      await updateCodeCommand.execute({ id: code.id, name: 'New name' } as any, ctx)
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(404)
    }
  })

  it('round-trips create → update → undo back to the pre-update snapshot', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { name: 'Original', usageAmount: null })
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine })

    const prepared = await updateCodeCommand.prepare!({ id: code.id, name: 'Changed' } as any, ctx)
    await updateCodeCommand.execute({ id: code.id, name: 'Changed' } as any, ctx)
    expect(code.name).toBe('Changed')

    const after = await updateCodeCommand.captureAfter!({ id: code.id, name: 'Changed' } as any, { codeId: code.id }, ctx)
    const logEntry = await updateCodeCommand.buildLog!({
      input: { id: code.id, name: 'Changed' } as any,
      result: { codeId: code.id },
      ctx,
      snapshots: { before: prepared && 'before' in prepared ? prepared.before : undefined, after },
    })
    expect(logEntry).not.toBeNull()

    const undoPayload = extractUndoPayload<{ before?: { name: string } }>({ commandPayload: logEntry!.payload } as any)
    expect(undoPayload?.before?.name).toBe('Original')

    await updateCodeCommand.undo!({ logEntry: { commandPayload: logEntry!.payload } as any, ctx, input: {} as any })
    expect(code.name).toBe('Original')
  })
})

describe('promotions.code.delete command', () => {
  it('soft-deletes the code and deactivates only its own active generated codes', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables)
    const otherCode = seedCode(tables)
    const ownActive = seedGeneratedCode(tables, { codeId: code.id, active: true })
    const ownAlreadyInactive = seedGeneratedCode(tables, { codeId: code.id, active: false })
    const otherActive = seedGeneratedCode(tables, { codeId: otherCode.id, active: true })
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine })

    await deleteCodeCommand.execute({ id: code.id } as any, ctx)

    expect(code.deletedAt).not.toBeNull()
    expect(ownActive.active).toBe(false)
    expect(ownAlreadyInactive.active).toBe(false)
    // A DIFFERENT code's generated row must never be touched by this delete.
    expect(otherActive.active).toBe(true)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }))
  })

  it('undo restores the Code row AND re-activates exactly the rows this delete deactivated, never ones already inactive for another reason', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables)
    const wasActive = seedGeneratedCode(tables, { codeId: code.id, active: true })
    const wasAlreadyInactive = seedGeneratedCode(tables, { codeId: code.id, active: false })
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine })

    const prepared = await deleteCodeCommand.prepare!({ id: code.id } as any, ctx)
    await deleteCodeCommand.execute({ id: code.id } as any, ctx)
    expect(wasActive.active).toBe(false)

    const logEntry = await deleteCodeCommand.buildLog!({
      input: { id: code.id } as any,
      result: { codeId: code.id },
      ctx,
      snapshots: { before: prepared && 'before' in prepared ? prepared.before : undefined },
    })
    expect(logEntry).not.toBeNull()

    await deleteCodeCommand.undo!({ logEntry: { commandPayload: logEntry!.payload } as any, ctx, input: {} as any })

    expect(code.deletedAt).toBeNull()
    expect(wasActive.active).toBe(true)
    // This row was already inactive BEFORE the delete (e.g. spent by `codes/use`) — undo
    // must not resurrect it just because it happens to belong to the same code.
    expect(wasAlreadyInactive.active).toBe(false)
  })

  it('answers a cross-tenant code as not-found (404)', async () => {
    const { em, tables } = createFakeEm()
    const code = seedCode(tables, { tenantId: 'other-tenant' })
    const dataEngine = fakeDataEngine()
    const ctx = fakeCtx(em, { dataEngine })

    expect.assertions(2)
    try {
      await deleteCodeCommand.execute({ id: code.id } as any, ctx)
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect(isCrudHttpError(err) && err.status).toBe(404)
    }
  })
})
