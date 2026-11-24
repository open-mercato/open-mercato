/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { createCacheService } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerModules, tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { setup as searchSetup } from '@open-mercato/search/modules/search/setup'
import { setup as notificationsSetup } from '../../../notifications/setup'
import {
  NOTIFICATIONS_DELIVERY_CONFIG_KEY,
  resolveStoredDefaultNotificationDeliveryConfig,
} from '../../../notifications/lib/deliveryConfig'
import { createModuleConfigService, restoreInstanceDefaultsStrict } from '../module-config-service'
import { collectInstanceConfigDefaults } from '../instance-defaults'

const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

import configsCli from '../../cli'

type Row = {
  id: string
  moduleId: string
  name: string
  valueJson: unknown
  tenantId: string | null
  organizationId: string | null
  createdAt: Date
  updatedAt: Date
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const current = (row as Record<string, unknown>)[key]
    return value === null ? current === null || current === undefined : current === value
  })
}

function cloneRows(rows: Row[]): Row[] {
  return rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
  }))
}

type FakeEmHooks = {
  onFindOne?: (where: Record<string, unknown>, callIndex: number) => void
  onPersist?: (entity: Row, callIndex: number) => void
  onFlush?: (attempt: number) => void
}

function createTransactionalFakeEm(initialRows: Row[] = [], hooks: FakeEmHooks = {}) {
  let committedRows: Row[] = cloneRows(initialRows)
  let seq = committedRows.length
  let forkCount = 0
  let transactionAttempt = 0

  const makeManager = (backingRowsRef: () => Row[], onCommit?: (next: Row[]) => void): any => {
    let findOneCalls = 0
    let persistCalls = 0

    const makeRepo = (workingRows: Row[]) => ({
      async findOne(where: Record<string, unknown>): Promise<Row | null> {
        findOneCalls += 1
        hooks.onFindOne?.(where, findOneCalls)
        return workingRows.find((row) => matches(row, where)) ?? null
      },
      create(data: Partial<Row>): Row {
        const now = new Date()
        return {
          id: `row-${seq++}`,
          moduleId: data.moduleId!,
          name: data.name!,
          valueJson: data.valueJson ?? null,
          tenantId: data.tenantId ?? null,
          organizationId: data.organizationId ?? null,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
        }
      },
    })

    const manager: any = {
      getRepository: () => makeRepo(backingRowsRef()),
      persist: (entity: Row) => {
        persistCalls += 1
        hooks.onPersist?.(entity, persistCalls)
        const target = backingRowsRef()
        if (!target.includes(entity)) target.push(entity)
        return manager
      },
      flush: async () => {
        hooks.onFlush?.(transactionAttempt)
        onCommit?.(backingRowsRef())
      },
      fork: jest.fn(() => {
        forkCount += 1
        return makeManager(() => committedRows)
      }),
      transactional: async <T>(cb: (txEm: any) => Promise<T>): Promise<T> => {
        transactionAttempt += 1
        const stagedRows = cloneRows(committedRows)
        let flushed = false
        const txEm = makeManager(
          () => stagedRows,
          () => {
            flushed = true
          },
        )
        const result = await cb(txEm)
        // Commit staged changes only when the transaction callback succeeds
        if (flushed) {
          committedRows = stagedRows
        }
        return result
      },
    }

    return manager
  }

  const em = makeManager(() => committedRows)
  return {
    em,
    getRows: () => committedRows,
    getForkCount: () => forkCount,
    getTransactionAttempts: () => transactionAttempt,
  }
}

function createHarness(
  initialRows: Row[] = [],
  options: {
    hooks?: FakeEmHooks
    omitEm?: boolean
    omitService?: boolean
    cacheOverride?: any
  } = {},
) {
  const fake = createTransactionalFakeEm(initialRows, options.hooks)
  const cache = options.cacheOverride ?? createCacheService({ strategy: 'memory' })
  const dispose = jest.fn().mockResolvedValue(undefined)
  let service!: ReturnType<typeof createModuleConfigService>
  const container = {
    resolve: (token: string) => {
      if (token === 'em') {
        if (options.omitEm) throw new Error('em not registered')
        return fake.em
      }
      if (token === 'cache') return cache
      if (token === 'moduleConfigService') {
        if (options.omitService) throw new Error('moduleConfigService not registered')
        return service
      }
      throw new Error(`unknown token ${token}`)
    },
    dispose,
  } as unknown as AppContainer
  service = createModuleConfigService(container)
  return {
    container,
    em: fake.em,
    getRows: fake.getRows,
    getForkCount: fake.getForkCount,
    getTransactionAttempts: fake.getTransactionAttempts,
    cache,
    service,
    dispose,
  }
}

const restoreDefaultsCommand = configsCli.find((command) => command.command === 'restore-defaults')!
const TENANT_A = '11111111-1111-1111-1111-111111111111'

const enabledSearchModule: Module = { id: 'search', setup: searchSetup }
const enabledNotificationsModule: Module = { id: 'notifications', setup: notificationsSetup }
const enabledConfigsModule: Module = { id: 'configs' }

describe('module-owned instance config defaults (configs restore-defaults)', () => {
  let previousModules: Module[] | null
  let originalPrimaryEnv: string | undefined
  let originalLegacyEnv: string | undefined
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    previousModules = tryGetModules()
    originalPrimaryEnv = process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    originalLegacyEnv = process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
    delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    delete process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    registerModules(previousModules ?? [])
    if (originalPrimaryEnv === undefined) delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    else process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING = originalPrimaryEnv
    if (originalLegacyEnv === undefined) delete process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
    else process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING = originalLegacyEnv
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('decouples configs/cli.ts from direct notifications imports', () => {
    const cliSource = fs.readFileSync(path.resolve(__dirname, '../../cli.ts'), 'utf8')
    expect(cliSource).not.toContain('notifications/lib/deliveryConfig')
    expect(cliSource).not.toContain('STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG')
  })

  it('restores both enabled owners at instance scope, refreshes warmed cache, and preserves tenant overrides', async () => {
    registerModules([enabledConfigsModule, enabledSearchModule, enabledNotificationsModule])
    const oldDate = new Date('2025-01-01T00:00:00.000Z')
    const harness = createHarness([
      {
        id: 'existing-global-vector',
        moduleId: 'vector',
        name: 'auto_index_enabled',
        valueJson: false,
        tenantId: null,
        organizationId: null,
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      {
        id: 'tenant-vector-override',
        moduleId: 'vector',
        name: 'auto_index_enabled',
        valueJson: false,
        tenantId: TENANT_A,
        organizationId: null,
        createdAt: oldDate,
        updatedAt: oldDate,
      },
    ])

    // Warm the cache with the stale pre-restore global value
    expect(await harness.service.getValue('vector', 'auto_index_enabled')).toBe(false)

    mockCreateRequestContainer.mockResolvedValue(harness.container)
    await restoreDefaultsCommand.run([])

    const rows = harness.getRows()
    const globalVector = rows.find(
      (row) => row.moduleId === 'vector' && row.name === 'auto_index_enabled' && row.tenantId === null,
    )
    const tenantVector = rows.find(
      (row) => row.moduleId === 'vector' && row.name === 'auto_index_enabled' && row.tenantId === TENANT_A,
    )
    const globalNotifications = rows.find(
      (row) =>
        row.moduleId === 'notifications' &&
        row.name === NOTIFICATIONS_DELIVERY_CONFIG_KEY &&
        row.tenantId === null,
    )

    expect(globalVector?.valueJson).toBe(true)
    expect(globalVector!.updatedAt.getTime()).toBeGreaterThan(oldDate.getTime())
    expect(tenantVector?.valueJson).toBe(false)
    expect(tenantVector?.updatedAt.getTime()).toBe(oldDate.getTime())
    expect(globalNotifications?.valueJson).toEqual(
      JSON.parse(JSON.stringify(resolveStoredDefaultNotificationDeliveryConfig())),
    )

    // Warmed cache reflects the newly committed instance default
    expect(await harness.service.getValue('vector', 'auto_index_enabled')).toBe(true)
    expect(await harness.service.getValue('vector', 'auto_index_enabled', { scope: { tenantId: TENANT_A } })).toBe(
      false,
    )

    const output = logSpy.mock.calls.flat().map(String).join('\n')
    expect(output).toContain('[configs] Vector auto-indexing default set to enabled.')
    expect(harness.getForkCount()).toBe(1)
    expect(harness.dispose).toHaveBeenCalledTimes(1)
  })

  it('when Search is disabled and Notifications is enabled, preserves pre-existing Search row/timestamp and emits no vector status line', async () => {
    registerModules([enabledConfigsModule, enabledNotificationsModule])
    const preservedAt = new Date('2025-02-03T04:05:06.000Z')
    const harness = createHarness([
      {
        id: 'existing-search-row',
        moduleId: 'vector',
        name: 'auto_index_enabled',
        valueJson: false,
        tenantId: null,
        organizationId: null,
        createdAt: preservedAt,
        updatedAt: preservedAt,
      },
    ])
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await restoreDefaultsCommand.run([])

    const rows = harness.getRows()
    const vectorRow = rows.find((row) => row.moduleId === 'vector' && row.name === 'auto_index_enabled')
    const notificationsRow = rows.find(
      (row) => row.moduleId === 'notifications' && row.name === NOTIFICATIONS_DELIVERY_CONFIG_KEY,
    )
    expect(vectorRow?.valueJson).toBe(false)
    expect(vectorRow?.updatedAt.getTime()).toBe(preservedAt.getTime())
    expect(notificationsRow).toBeDefined()

    const output = logSpy.mock.calls.flat().map(String).join('\n')
    expect(output).not.toContain('Vector auto-indexing')
  })

  it('when Search is disabled and has no existing row, inserts no Search row', async () => {
    registerModules([enabledConfigsModule, enabledNotificationsModule])
    const harness = createHarness()
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await restoreDefaultsCommand.run([])

    expect(harness.getRows().map((row) => `${row.moduleId}.${row.name}`)).toEqual([
      `notifications.${NOTIFICATIONS_DELIVERY_CONFIG_KEY}`,
    ])
  })

  it('when Notifications is disabled and Search is enabled, preserves Notifications row/timestamp and respects env precedence', async () => {
    registerModules([enabledConfigsModule, enabledSearchModule])
    const preservedAt = new Date('2025-03-04T05:06:07.000Z')
    process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING = 'false'
    process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING = 'true'

    const harness = createHarness([
      {
        id: 'existing-notifications-row',
        moduleId: 'notifications',
        name: NOTIFICATIONS_DELIVERY_CONFIG_KEY,
        valueJson: { panelPath: '/custom' },
        tenantId: null,
        organizationId: null,
        createdAt: preservedAt,
        updatedAt: preservedAt,
      },
    ])
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await restoreDefaultsCommand.run([])

    const rows = harness.getRows()
    expect(rows.find((row) => row.moduleId === 'vector')?.valueJson).toBe(true)
    const notificationsRow = rows.find((row) => row.moduleId === 'notifications')
    expect(notificationsRow?.valueJson).toEqual({ panelPath: '/custom' })
    expect(notificationsRow?.updatedAt.getTime()).toBe(preservedAt.getTime())

    // Legacy env fallback still disables when primary env is unset
    delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING = '1'
    mockCreateRequestContainer.mockResolvedValue(harness.container)
    await restoreDefaultsCommand.run([])
    expect(harness.getRows().find((row) => row.moduleId === 'vector')?.valueJson).toBe(false)
    const output = logSpy.mock.calls.flat().map(String).join('\n')
    expect(output).toContain(
      'forced by OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING or legacy DISABLE_VECTOR_SEARCH_AUTOINDEXING',
    )
  })

  it('treats an empty enabled catalog as a successful no-op and restores again once an owner is re-enabled', async () => {
    registerModules([enabledConfigsModule])
    const harness = createHarness()
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await restoreDefaultsCommand.run([])
    expect(harness.getRows()).toHaveLength(0)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()

    // Re-enabling search restores its default on the next run
    registerModules([enabledConfigsModule, enabledSearchModule])
    await restoreDefaultsCommand.run([])
    expect(harness.getRows().map((row) => `${row.moduleId}.${row.name}`)).toEqual([
      'vector.auto_index_enabled',
    ])
  })

  it('rejects duplicate normalized keys, unauthorized cross-namespace writes, and malformed JSON descriptors before any write', async () => {
    const duplicateModules: Module[] = [
      {
        id: 'alpha',
        setup: {
          instanceConfigDefaults: () => [
            { name: 'same_key', value: 1 },
            { name: '  same_key  ', value: 2 },
          ],
        },
      },
    ]
    expect(() => collectInstanceConfigDefaults(duplicateModules)).toThrow(/Duplicate instance config default key/)

    const unauthorizedLegacy: Module[] = [
      {
        id: 'notifications',
        setup: {
          instanceConfigDefaults: () => [
            { name: 'auto_index_enabled', value: true, legacyStorageNamespace: 'vector' },
          ],
        },
      },
    ]
    expect(() => collectInstanceConfigDefaults(unauthorizedLegacy)).toThrow(/Unauthorized cross-namespace/)

    const wrongSearchKey: Module[] = [
      {
        id: 'search',
        setup: {
          instanceConfigDefaults: () => [
            { name: 'other_key', value: true, legacyStorageNamespace: 'vector' },
          ],
        },
      },
    ]
    expect(() => collectInstanceConfigDefaults(wrongSearchKey)).toThrow(/Unauthorized cross-namespace/)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    const sparseArray = new Array(2)
    sparseArray[1] = 1

    const malformedValues: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      BigInt(1),
      () => 'fn',
      Symbol('s'),
      new Date(),
      circular,
      [undefined],
      sparseArray,
    ]

    for (const badValue of malformedValues) {
      expect(() =>
        collectInstanceConfigDefaults([
          {
            id: 'alpha',
            setup: {
              instanceConfigDefaults: () => [{ name: 'bad', value: badValue }],
            },
          },
        ]),
      ).toThrow(/Invalid instance config default/)
    }

    // Async provider (both resolving and rejecting) is rejected synchronously before any write
    const asyncModules: Module[] = [
      {
        id: 'alpha',
        setup: {
          instanceConfigDefaults: (() => Promise.resolve([])) as any,
        },
      },
    ]
    expect(() => collectInstanceConfigDefaults(asyncModules)).toThrow(/must be synchronous/)

    const rejectingAsyncModules: Module[] = [
      {
        id: 'alpha',
        setup: {
          instanceConfigDefaults: (() => Promise.reject(new Error('async boom'))) as any,
        },
      },
    ]
    expect(() => collectInstanceConfigDefaults(rejectingAsyncModules)).toThrow(/must be synchronous/)

    // Dedupe keys do not collide across colon-containing moduleId/name boundaries
    const colonDistinct = collectInstanceConfigDefaults([
      {
        id: 'a',
        setup: {
          instanceConfigDefaults: () => [{ name: 'b:c', value: 1 }],
        },
      },
      {
        id: 'a:b',
        setup: {
          instanceConfigDefaults: () => [{ name: 'c', value: 2 }],
        },
      },
    ])
    expect(colonDistinct.map((entry) => [entry.moduleId, entry.name])).toEqual([
      ['a', 'b:c'],
      ['a:b', 'c'],
    ])

    // Non-secret error check: never echo secret-looking values on invalid sibling fields
    expect(() =>
      collectInstanceConfigDefaults([
        {
          id: 'alpha',
          setup: {
            instanceConfigDefaults: () => [
              { name: 'secret_holder', value: { token: 'super-secret-value-123', invalid: Number.NaN } },
            ],
          },
        },
      ]),
    ).not.toThrow(/super-secret-value-123/)
  })

  it('retries with a fresh EntityManager fork on unique-constraint conflict (23505) and succeeds', async () => {
    registerModules([enabledConfigsModule, enabledSearchModule])
    let failedOnce = false
    const harness = createHarness([], {
      hooks: {
        onFlush: (attempt) => {
          if (attempt === 1 && !failedOnce) {
            failedOnce = true
            throw Object.assign(new Error('duplicate key value violates unique constraint "module_configs_global_unique"'), {
              code: '23505',
            })
          }
        },
      },
    })
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await restoreDefaultsCommand.run([])

    expect(harness.getTransactionAttempts()).toBe(2)
    expect(harness.getForkCount()).toBe(2)
    expect(harness.getRows().find((row) => row.moduleId === 'vector')?.valueJson).toBe(true)
  })

  it('fails loudly when EntityManager or moduleConfigService is missing without publishing cache', async () => {
    registerModules([enabledConfigsModule, enabledSearchModule])

    const noEmHarness = createHarness([], { omitEm: true })
    mockCreateRequestContainer.mockResolvedValueOnce(noEmHarness.container)
    await expect(restoreDefaultsCommand.run([])).rejects.toThrow(/EntityManager is not registered/)
    expect(await noEmHarness.cache.keys()).toHaveLength(0)

    const noServiceHarness = createHarness([], { omitService: true })
    mockCreateRequestContainer.mockResolvedValueOnce(noServiceHarness.container)
    await expect(restoreDefaultsCommand.run([])).rejects.toThrow(/moduleConfigService is not registered/)
    expect(await noServiceHarness.cache.keys()).toHaveLength(0)
  })

  it('rolls back staged writes and publishes no cache on lookup, later-entry persist, or flush failure', async () => {
    registerModules([enabledConfigsModule, enabledSearchModule, enabledNotificationsModule])

    // 1. Lookup failure
    const lookupFail = createHarness([], {
      hooks: {
        onFindOne: () => {
          throw new Error('lookup exploded')
        },
      },
    })
    mockCreateRequestContainer.mockResolvedValueOnce(lookupFail.container)
    await expect(restoreDefaultsCommand.run([])).rejects.toThrow('lookup exploded')
    expect(lookupFail.getRows()).toHaveLength(0)
    expect(await lookupFail.cache.keys()).toHaveLength(0)

    // 2. Later-entry persist failure after first entry was already staged
    const persistFail = createHarness([], {
      hooks: {
        onPersist: (_entity, callIndex) => {
          if (callIndex === 2) throw new Error('second persist failed')
        },
      },
    })
    mockCreateRequestContainer.mockResolvedValueOnce(persistFail.container)
    await expect(restoreDefaultsCommand.run([])).rejects.toThrow('second persist failed')
    expect(persistFail.getRows()).toHaveLength(0)
    expect(await persistFail.cache.keys()).toHaveLength(0)

    // 3. Flush failure after both entries were staged
    const flushFail = createHarness([], {
      hooks: {
        onFlush: () => {
          throw new Error('commit failed')
        },
      },
    })
    mockCreateRequestContainer.mockResolvedValueOnce(flushFail.container)
    await expect(restoreDefaultsCommand.run([])).rejects.toThrow('commit failed')
    expect(flushFail.getRows()).toHaveLength(0)
    expect(await flushFail.cache.keys()).toHaveLength(0)
  })

  it('tolerates cache outage after commit without failing the strict restore', async () => {
    registerModules([enabledConfigsModule, enabledSearchModule])
    const brokenCache = {
      get: async () => {
        throw new Error('redis down')
      },
      set: async () => {
        throw new Error('redis down')
      },
      delete: async () => {
        throw new Error('redis down')
      },
      deleteByTags: async () => {
        throw new Error('redis down')
      },
    }
    const harness = createHarness([], { cacheOverride: brokenCache })
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await expect(restoreDefaultsCommand.run([])).resolves.toBeUndefined()
    expect(harness.getRows().find((row) => row.moduleId === 'vector')?.valueJson).toBe(true)
  })

  it('keeps existing moduleConfigService.restoreDefaults best-effort behavior intact for legacy callers', async () => {
    const noEmHarness = createHarness([], { omitEm: true })
    await expect(
      noEmHarness.service.restoreDefaults([{ moduleId: 'custom', name: 'k', value: 1 }]),
    ).resolves.toBeUndefined()

    const harness = createHarness()
    await expect(
      harness.service.restoreDefaults([
        { moduleId: '', name: 'bad', value: 1 },
        { moduleId: 'custom', name: 'good', value: 'ok' },
      ]),
    ).resolves.toBeUndefined()

    expect(harness.getRows().map((row) => `${row.moduleId}.${row.name}`)).toEqual(['custom.good'])

    // Strict restore rejects the same malformed entry before touching DB
    await expect(
      restoreInstanceDefaultsStrict(harness.container, [{ moduleId: '', name: 'bad', value: 1 }]),
    ).rejects.toThrow(/Invalid instance config default key/)

    // Non-finite maxConflictRetries normalizes to default attempts instead of skipping writes
    const nanRetryHarness = createHarness()
    const restored = await restoreInstanceDefaultsStrict(
      nanRetryHarness.container,
      [{ moduleId: 'custom', name: 'k', value: 42 }],
      { maxConflictRetries: Number.NaN },
    )
    expect(restored).toHaveLength(1)
    expect(nanRetryHarness.getRows().find((row) => row.name === 'k')?.valueJson).toBe(42)
  })
})
