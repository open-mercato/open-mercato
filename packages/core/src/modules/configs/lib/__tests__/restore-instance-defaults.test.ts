/** @jest-environment node */
import { createCacheService } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerModules, tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { createModuleConfigService } from '../module-config-service'
import {
  NOTIFICATIONS_DELIVERY_CONFIG_KEY,
  STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
} from '../../../notifications/lib/deliveryConfig'

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

function createFakeEm(initialRows: Row[] = []) {
  const rows: Row[] = [...initialRows]
  let seq = rows.length
  const repo = {
    async findOne(where: Record<string, unknown>): Promise<Row | null> {
      return rows.find((row) => matches(row, where)) ?? null
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
  }
  return {
    rows,
    em: {
      getRepository: () => repo,
      persist: (entity: Row) => {
        if (!rows.includes(entity)) rows.push(entity)
      },
      flush: async () => {},
    },
  }
}

function createHarness(initialRows: Row[] = []) {
  const { em, rows } = createFakeEm(initialRows)
  const cache = createCacheService({ strategy: 'memory' })
  const dispose = jest.fn().mockResolvedValue(undefined)
  let service!: ReturnType<typeof createModuleConfigService>
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'cache') return cache
      if (token === 'moduleConfigService') return service
      throw new Error(`unknown token ${token}`)
    },
    dispose,
  } as unknown as AppContainer
  service = createModuleConfigService(container)
  return { container, em, rows, cache, service, dispose }
}

const restoreDefaultsCommand = configsCli.find((command) => command.command === 'restore-defaults')!
const TENANT_A = '11111111-1111-1111-1111-111111111111'

describe('configs restore-defaults characterization (pre-cutover baseline)', () => {
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

  it('force-restores the two built-in defaults at instance scope without touching tenant overrides', async () => {
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
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await restoreDefaultsCommand.run([])

    const globalVector = harness.rows.find(
      (row) => row.moduleId === 'vector' && row.name === 'auto_index_enabled' && row.tenantId === null,
    )
    const tenantVector = harness.rows.find(
      (row) => row.moduleId === 'vector' && row.name === 'auto_index_enabled' && row.tenantId === TENANT_A,
    )
    const globalNotifications = harness.rows.find(
      (row) =>
        row.moduleId === 'notifications' &&
        row.name === NOTIFICATIONS_DELIVERY_CONFIG_KEY &&
        row.tenantId === null,
    )

    expect(globalVector?.valueJson).toBe(true)
    expect(tenantVector?.valueJson).toBe(false)
    expect(globalNotifications?.valueJson).toEqual(STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG)
    expect(harness.dispose).toHaveBeenCalledTimes(1)
  })

  it('writes hardcoded search and notifications defaults even when those modules are disabled today', async () => {
    registerModules([{ id: 'configs' }])
    const harness = createHarness()
    mockCreateRequestContainer.mockResolvedValue(harness.container)

    await restoreDefaultsCommand.run([])

    expect(harness.rows.map((row) => `${row.moduleId}.${row.name}`).sort()).toEqual([
      `notifications.${NOTIFICATIONS_DELIVERY_CONFIG_KEY}`,
      'vector.auto_index_enabled',
    ])
  })

  it('applies primary over legacy vector auto-indexing env precedence', async () => {
    process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING = 'false'
    process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING = 'true'
    const primaryWins = createHarness()
    mockCreateRequestContainer.mockResolvedValueOnce(primaryWins.container)

    await restoreDefaultsCommand.run([])
    expect(
      primaryWins.rows.find((row) => row.moduleId === 'vector' && row.name === 'auto_index_enabled')?.valueJson,
    ).toBe(true)

    delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING = '1'
    const legacyFallback = createHarness()
    mockCreateRequestContainer.mockResolvedValueOnce(legacyFallback.container)

    await restoreDefaultsCommand.run([])
    expect(
      legacyFallback.rows.find((row) => row.moduleId === 'vector' && row.name === 'auto_index_enabled')?.valueJson,
    ).toBe(false)
  })
})
