import { createModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveEmbeddingConfigResult,
  saveEmbeddingConfig,
} from '../embedding-config'
import {
  resolveGlobalSearchStrategiesResult,
  saveGlobalSearchStrategies,
} from '../global-search-config'
import type { EmbeddingProviderConfig } from '../../../../vector'

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

function createServiceResolver() {
  const rows: Row[] = []
  let seq = 0
  const store = new Map<string, unknown>()
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
  const em = {
    getRepository: () => repo,
    persist: (entity: Row) => rows.push(entity),
    flush: async () => {},
  }
  const cache = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, value)
    },
    delete: async (key: string) => {
      store.delete(key)
    },
    deleteByTags: async () => {
      store.clear()
    },
  }
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'cache') return cache
      throw new Error(`unknown token ${token}`)
    },
  } as unknown as AppContainer
  const service = createModuleConfigService(container)
  const resolver = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'moduleConfigService') return service as unknown as T
      throw new Error(`unknown token ${name}`)
    },
  }
  return { resolver, rows }
}

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'

const TENANT_A_CONFIG: EmbeddingProviderConfig = {
  providerId: 'openai',
  model: 'text-embedding-3-large',
  dimension: 3072,
  updatedAt: new Date().toISOString(),
}

describe('search settings tenant scoping (helper-level integration)', () => {
  const previousKey = process.env.OPENAI_API_KEY
  beforeAll(() => {
    // Make the env-derived default deterministic across phases (key-presence gate).
    process.env.OPENAI_API_KEY = 'test-key'
  })
  afterAll(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousKey
  })

  it('embedding config: Tenant A save does not change Tenant B (B inherits env default)', async () => {
    const { resolver } = createServiceResolver()

    await saveEmbeddingConfig(resolver, TENANT_A_CONFIG, { scope: { tenantId: TENANT_A } })

    const a = await resolveEmbeddingConfigResult(resolver, { scope: { tenantId: TENANT_A } })
    expect(a.source).toBe('tenant')
    expect(a.config?.model).toBe('text-embedding-3-large')

    const b = await resolveEmbeddingConfigResult(resolver, { scope: { tenantId: TENANT_B } })
    expect(b.source).toBe('env')
    expect(b.config?.providerId).toBe('openai')
    expect(b.config?.model).toBe('text-embedding-3-small')
  })

  it('embedding config: a tenant inherits the instance row until it overrides', async () => {
    const { resolver } = createServiceResolver()

    // Instance default (no scope -> global row)
    await saveEmbeddingConfig(resolver, { ...TENANT_A_CONFIG, model: 'instance-model' })

    const inherited = await resolveEmbeddingConfigResult(resolver, { scope: { tenantId: TENANT_A } })
    expect(inherited.source).toBe('instance')
    expect(inherited.config?.model).toBe('instance-model')

    await saveEmbeddingConfig(resolver, TENANT_A_CONFIG, { scope: { tenantId: TENANT_A } })
    const overridden = await resolveEmbeddingConfigResult(resolver, { scope: { tenantId: TENANT_A } })
    expect(overridden.source).toBe('tenant')
    expect(overridden.config?.model).toBe('text-embedding-3-large')
  })

  it('global-search strategies: Tenant A save does not change Tenant B', async () => {
    const { resolver } = createServiceResolver()

    await saveGlobalSearchStrategies(resolver, ['fulltext'], { scope: { tenantId: TENANT_A } })

    const a = await resolveGlobalSearchStrategiesResult(resolver, { scope: { tenantId: TENANT_A } })
    expect(a.source).toBe('tenant')
    expect(a.strategies).toEqual(['fulltext'])

    const b = await resolveGlobalSearchStrategiesResult(resolver, { scope: { tenantId: TENANT_B } })
    expect(b.source).toBe('env')
    expect(b.strategies).toEqual(['fulltext', 'vector', 'tokens'])
  })
})
