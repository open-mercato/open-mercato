import { asValue, createContainer } from 'awilix'
import { createCacheService, runWithCacheTenant } from '@open-mercato/cache'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DEFAULT_DEAL_STATUS_VOCABULARY } from '../../data/dealStatusVocabulary'

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

import { saveDealStatusVocabularyCommand as command } from '../dealStatusVocabulary'

const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const originalVersion = '2026-10-18T09:00:00.000Z'
const nextVocabulary = { won: ['signed'], lost: ['rejected'], closed: ['archived'] }
type StoredConfig = {
  moduleId: string; name: string; valueJson: unknown; tenantId: string | null; organizationId: string | null
  createdAt: Date; updatedAt: Date
}
type TestEntityManager = {
  fork: () => TestEntityManager
  getTransactionContext: () => { transaction: symbol }
  getConnection: () => { execute: (sql: string, parameters: string[], method: string, context: unknown) => Promise<unknown[]> }
  getRepository: () => { findOne: (filter: { tenantId: string | null }) => Promise<StoredConfig | null | undefined>; create: (input: StoredConfig) => StoredConfig }
  persist: (record: StoredConfig) => void
  flush: () => Promise<void>
  transactional: <TResult>(callback: (transactionEm: TestEntityManager) => Promise<TResult>) => Promise<TResult>
  commit: () => void
  release: () => void
}
const records = new Map<string, StoredConfig>()
const locks = new Map<string, Promise<void>>()
const hasFeature = jest.fn()
const sqlMock = jest.fn()
const trace: string[] = []
let flushInterceptor: (() => Promise<void>) | undefined
let committedWrites = 0

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function createEm(transactional = false): TestEntityManager {
  const managed = new Map<string, StoredConfig>()
  const staged = new Map<string, StoredConfig>()
  let releaseLock: (() => void) | undefined
  const transactionContext = { transaction: Symbol('transaction') }
  const em = {
    fork: () => createEm(),
    getTransactionContext: () => transactionContext,
    getConnection: () => ({
      execute: async (sql: string, parameters: string[], method: string, context: unknown) => {
        sqlMock(sql, parameters, method, context)
        const key = parameters.join(':')
        const predecessor = locks.get(key) ?? Promise.resolve()
        const gate = deferred()
        locks.set(key, gate.promise)
        await predecessor
        releaseLock = gate.resolve
        trace.push('lock')
        return []
      },
    }),
    getRepository: () => ({
      findOne: async (filter: { tenantId: string | null }) => {
        trace.push('read')
        const key = filter.tenantId ?? 'global'
        if (managed.has(key)) return managed.get(key)
        const stored = staged.get(key) ?? records.get(key)
        if (!stored) return null
        const copy = { ...stored }
        managed.set(key, copy)
        return copy
      },
      create: (input: StoredConfig) => input,
    }),
    persist: (record: StoredConfig) => { managed.set(record.tenantId ?? 'global', record) },
    flush: async () => {
      for (const [key, record] of managed) staged.set(key, { ...record })
      trace.push('flush')
      await flushInterceptor?.()
      if (!transactional) {
        for (const [key, record] of staged) records.set(key, record)
      }
    },
    transactional: async <TResult>(callback: (transactionEm: TestEntityManager) => Promise<TResult>): Promise<TResult> => {
      const transactionEm = createEm(true)
      try {
        const result = await callback(transactionEm)
        transactionEm.commit()
        return result
      } finally {
        transactionEm.release()
      }
    },
    commit: () => {
      for (const [key, record] of staged) records.set(key, record)
      if (staged.size) committedWrites += 1
      trace.push('commit')
    },
    release: () => { releaseLock?.() },
  }
  return em
}

function fixture() {
  const cache = createCacheService({ strategy: 'memory' })
  const container = createContainer()
  container.register({ em: asValue(createEm()), cache: asValue(cache), rbacService: asValue({ userHasAllFeatures: hasFeature }) })
  const service = createModuleConfigService(container)
  const invalidate = jest.spyOn(service, 'invalidate')
  container.register({ moduleConfigService: asValue(service) })
  return { container, cache, invalidate }
}

function context(fixtureState: ReturnType<typeof fixture>, expectedVersion?: string, selectedTenantId = tenantId): CommandRuntimeContext {
  return {
    container: fixtureState.container,
    auth: { sub: userId, tenantId: selectedTenantId, orgId: null },
    organizationScope: null, selectedOrganizationId: null, organizationIds: null,
    request: new Request('http://localhost/api/customers/settings/deal-status-vocabulary', {
      method: 'PUT', headers: expectedVersion ? { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion } : {},
    }),
  }
}

function seed(value: unknown, selectedTenantId = tenantId): void {
  records.set(selectedTenantId, {
    moduleId: 'customers', name: 'dealStatusVocabulary', valueJson: value,
    tenantId: selectedTenantId, organizationId: null,
    createdAt: new Date(originalVersion), updatedAt: new Date(originalVersion),
  })
}

async function executeWithSnapshots(ctx: CommandRuntimeContext, input: Parameters<typeof command.execute>[0] = { vocabulary: nextVocabulary }) {
  let before: unknown
  ctx.beforeTransactionalWrite = async (em) => {
    before = (await command.prepare!(input, { ...ctx, transactionalEm: em }))?.before
  }
  const result = await command.execute(input, ctx)
  const after = await command.captureAfter!(input, result, ctx)
  const log = await command.buildLog!({ input, result, ctx, snapshots: { before, after } })
  return { input, result, logEntry: { commandPayload: log?.payload }, log }
}

describe('tenant deal status vocabulary command', () => {
  const previousEnvironment = process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY
  const previousLockEnvironment = process.env.OM_OPTIMISTIC_LOCK
  const previousCrudCacheEnvironment = process.env.ENABLE_CRUD_API_CACHE

  beforeEach(() => {
    records.clear()
    locks.clear()
    trace.length = 0
    flushInterceptor = undefined
    committedWrites = 0
    jest.clearAllMocks()
    hasFeature.mockResolvedValue(true)
    delete process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY
    delete process.env.OM_OPTIMISTIC_LOCK
    process.env.ENABLE_CRUD_API_CACHE = 'true'
  })

  afterAll(() => {
    if (previousEnvironment === undefined) delete process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY
    else process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY = previousEnvironment
    if (previousLockEnvironment === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = previousLockEnvironment
    if (previousCrudCacheEnvironment === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousCrudCacheEnvironment
  })

  it('writes only the authenticated tenant and invalidates after commit', async () => {
    seed(DEFAULT_DEAL_STATUS_VOCABULARY, otherTenantId)
    const state = fixture()
    state.invalidate.mockImplementation(async () => { trace.push('invalidate') })
    const result = await command.execute({ vocabulary: nextVocabulary }, context(state))
    expect(result).toMatchObject({ vocabulary: nextVocabulary, source: 'tenant', updatedAt: expect.any(String) })
    expect(records.get(otherTenantId)?.valueJson).toEqual(DEFAULT_DEAL_STATUS_VOCABULARY)
    expect(records.get(tenantId)?.valueJson).toEqual(nextVocabulary)
    expect(sqlMock).toHaveBeenCalledWith('select pg_advisory_xact_lock(hashtext(?), hashtext(?))', [tenantId, 'customers.dealStatusVocabulary'], 'all', expect.any(Object))
    expect(trace.indexOf('lock')).toBeLessThan(trace.indexOf('read'))
    expect(trace.indexOf('commit')).toBeLessThan(trace.indexOf('invalidate'))
  })

  it('rejects conflicting groups and attempts to supply another tenant', async () => {
    const state = fixture()
    await expect(command.execute({ vocabulary: { ...nextVocabulary, lost: ['SIGNED'] } }, context(state))).rejects.toThrow()
    const scopedInput = { vocabulary: nextVocabulary, tenantId: otherTenantId }
    await expect(command.execute(scopedInput, context(state))).rejects.toThrow()
    expect(committedWrites).toBe(0)
  })

  it('rejects stale updates before any write', async () => {
    seed(DEFAULT_DEAL_STATUS_VOCABULARY)
    const state = fixture()
    await expect(command.execute({ vocabulary: nextVocabulary }, context(state, '2026-10-18T08:00:00.000Z'))).rejects.toMatchObject({
      status: 409, body: { code: 'optimistic_lock_conflict' },
    })
    expect(committedWrites).toBe(0)
  })

  it('serializes overlapping same-version writes and publishes no uncommitted cache record', async () => {
    seed(DEFAULT_DEAL_STATUS_VOCABULARY)
    const first = fixture()
    const second = fixture()
    const cacheSet = jest.spyOn(first.cache, 'set')
    const flushed = deferred()
    const proceed = deferred()
    flushInterceptor = async () => { flushed.resolve(); await proceed.promise }
    const firstWrite = command.execute({ vocabulary: nextVocabulary }, context(first, originalVersion))
    await flushed.promise
    const secondWrite = Promise.resolve(command.execute({ vocabulary: null }, context(second, originalVersion)))
    const settled = Promise.allSettled([firstWrite, secondWrite])
    await Promise.resolve()
    expect(records.get(tenantId)?.valueJson).toEqual(DEFAULT_DEAL_STATUS_VOCABULARY)
    expect(cacheSet).not.toHaveBeenCalled()
    expect(first.invalidate).not.toHaveBeenCalled()
    proceed.resolve()
    const results = await settled
    expect(results[0]).toMatchObject({ status: 'fulfilled' })
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { status: 409, body: { code: 'optimistic_lock_conflict' } } })
    expect(committedWrites).toBe(1)
    expect(records.get(tenantId)?.valueJson).toEqual(nextVocabulary)
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })

  it('resets to the environment default while keeping the tenant version', async () => {
    seed(nextVocabulary)
    process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY = JSON.stringify({ won: ['accepted'], lost: ['declined'], closed: ['ended'] })
    const state = fixture()
    const result = await command.execute({ vocabulary: null }, context(state, originalVersion))
    expect(result).toMatchObject({ source: 'env', updatedAt: expect.any(String), vocabulary: { won: ['accepted'] } })
    expect(records.get(tenantId)?.valueJson).toBeNull()
  })

  it('captures the serialized before snapshot and restores the matching after version', async () => {
    seed(DEFAULT_DEAL_STATUS_VOCABULARY)
    const state = fixture()
    const ctx = context(state, originalVersion)
    const execution = await executeWithSnapshots(ctx)
    expect(command.prepareSnapshotInsideTransaction).toBe(true)
    expect(execution.log).toMatchObject({ tenantId, organizationId: null, resourceId: tenantId, snapshotBefore: { value: DEFAULT_DEAL_STATUS_VOCABULARY, updatedAt: originalVersion } })
    await command.undo!({ input: execution.input, ctx, logEntry: execution.logEntry })
    expect(records.get(tenantId)?.valueJson).toEqual(DEFAULT_DEAL_STATUS_VOCABULARY)
    expect(state.invalidate).toHaveBeenCalledTimes(2)
  })

  it('refuses undo after a newer write and preserves exact after snapshots across later saves', async () => {
    seed(DEFAULT_DEAL_STATUS_VOCABULARY)
    const state = fixture()
    const ctx = context(state, originalVersion)
    const execution = await executeWithSnapshots(ctx)
    records.get(tenantId)!.updatedAt = new Date('2099-01-01T00:00:00.000Z')
    records.get(tenantId)!.valueJson = { won: ['accepted'], lost: ['declined'], closed: ['ended'] }
    const after = await command.captureAfter!(execution.input, execution.result, ctx)
    expect(after).toEqual({ tenantId, value: nextVocabulary, updatedAt: execution.result.updatedAt })
    await expect(command.undo!({ input: execution.input, ctx, logEntry: execution.logEntry })).rejects.toMatchObject({ status: 409 })
    expect(records.get(tenantId)?.valueJson).toMatchObject({ won: ['accepted'] })
  })

  it('restores an unset override and refuses cross-tenant replay', async () => {
    const state = fixture()
    const ctx = context(state)
    const execution = await executeWithSnapshots(ctx)
    await expect(command.undo!({ input: execution.input, ctx: context(state, undefined, otherTenantId), logEntry: execution.logEntry })).rejects.toMatchObject({ status: 403 })
    await command.undo!({ input: execution.input, ctx, logEntry: execution.logEntry })
    expect(records.get(tenantId)?.valueJson).toBeNull()
  })

  it('invalidates deal lists and company metrics across tenant organizations on save, reset, and undo', async () => {
    const state = fixture()
    const fill = async () => {
      for (const selectedTenantId of [tenantId, otherTenantId]) {
        await runWithCacheTenant(selectedTenantId, async () => {
          await state.cache.set('deals:org-a', { items: ['a'] }, { tags: ['crud:segment:deals', `org:${selectedTenantId}:a`] })
          await state.cache.set('deals:org-b', { items: ['b'] }, { tags: ['crud:segment:deals', `org:${selectedTenantId}:b`] })
          await state.cache.set('people:org-a', { items: ['person'] }, { tags: ['crud:segment:people'] })
          const vocabularyTag = `crud:customers.deal.status.vocabulary:tenant:${selectedTenantId}:org:null:collection`
          await state.cache.set('company-detail:org-a', { kpis: { wonDeals: 1 } }, { tags: [vocabularyTag, `crud:customers.company:tenant:${selectedTenantId}:org:org-a:collection`] })
          await state.cache.set('company-detail:org-b', { kpis: { wonDeals: 2 } }, { tags: [vocabularyTag, `crud:customers.company:tenant:${selectedTenantId}:org:org-b:collection`] })
        })
      }
    }
    const assertIsolation = async () => {
      await runWithCacheTenant(tenantId, async () => {
        expect(await state.cache.get('deals:org-a')).toBeNull()
        expect(await state.cache.get('deals:org-b')).toBeNull()
        expect(await state.cache.get('people:org-a')).toEqual({ items: ['person'] })
        expect(await state.cache.get('company-detail:org-a')).toBeNull()
        expect(await state.cache.get('company-detail:org-b')).toBeNull()
      })
      await runWithCacheTenant(otherTenantId, async () => {
        expect(await state.cache.get('deals:org-a')).toEqual({ items: ['a'] })
        expect(await state.cache.get('deals:org-b')).toEqual({ items: ['b'] })
        expect(await state.cache.get('company-detail:org-a')).toEqual({ kpis: { wonDeals: 1 } })
        expect(await state.cache.get('company-detail:org-b')).toEqual({ kpis: { wonDeals: 2 } })
      })
    }
    await fill()
    const ctx = context(state)
    const execution = await executeWithSnapshots(ctx)
    await assertIsolation()
    await fill()
    const reset = await executeWithSnapshots(context(state, execution.result.updatedAt ?? undefined), { vocabulary: null })
    await assertIsolation()
    await fill()
    await command.undo!({ input: reset.input, ctx, logEntry: reset.logEntry })
    await assertIsolation()
  })

  it('requires an authenticated manager for writes and replay', async () => {
    const state = fixture()
    const unauthenticated = { ...context(state), auth: null }
    await expect(command.execute({ vocabulary: null }, unauthenticated)).rejects.toMatchObject({ status: 401 })
    hasFeature.mockResolvedValue(false)
    await expect(command.execute({ vocabulary: null }, context(state))).rejects.toMatchObject({ status: 403 })
    expect(committedWrites).toBe(0)
  })
})
