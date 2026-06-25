import { createModuleConfigService } from '../module-config-service'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

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

function createFakeEm() {
  const rows: Row[] = []
  let seq = 0
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
        rows.push(entity)
      },
      flush: async () => {},
    },
  }
}

function createFakeCache() {
  const store = new Map<string, unknown>()
  return {
    keys: () => [...store.keys()],
    cache: {
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
    },
  }
}

function createContainer() {
  const { em, rows } = createFakeEm()
  const { cache, keys } = createFakeCache()
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'cache') return cache
      throw new Error(`unknown token ${token}`)
    },
  } as unknown as AppContainer
  return { container, rows, cacheKeys: keys }
}

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'

describe('ModuleConfigService tenant scoping', () => {
  it('resolves scoped -> global -> null', async () => {
    const { container } = createContainer()
    const service = createModuleConfigService(container)

    expect(await service.getRecord('vector', 'embedding_config', { tenantId: TENANT_A })).toBeNull()

    await service.setValue('vector', 'embedding_config', { provider: 'instance' })
    const inherited = await service.getRecord('vector', 'embedding_config', { tenantId: TENANT_A })
    expect(inherited?.value).toEqual({ provider: 'instance' })
    expect(inherited?.source).toBe('instance')

    await service.setValue('vector', 'embedding_config', { provider: 'tenant-a' }, { tenantId: TENANT_A })
    const scoped = await service.getRecord('vector', 'embedding_config', { tenantId: TENANT_A })
    expect(scoped?.value).toEqual({ provider: 'tenant-a' })
    expect(scoped?.source).toBe('tenant')
  })

  it('isolates scoped writes between tenants and the global row', async () => {
    const { container, rows } = createContainer()
    const service = createModuleConfigService(container)

    await service.setValue('vector', 'embedding_config', { provider: 'global' })
    await service.setValue('vector', 'embedding_config', { provider: 'tenant-a' }, { tenantId: TENANT_A })

    const tenantB = await service.getRecord('vector', 'embedding_config', { tenantId: TENANT_B })
    expect(tenantB?.value).toEqual({ provider: 'global' })
    expect(tenantB?.source).toBe('instance')

    const global = await service.getRecord('vector', 'embedding_config')
    expect(global?.value).toEqual({ provider: 'global' })

    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.tenantId === null)).toHaveLength(1)
  })

  it('keeps the no-scope path on the global row (BC)', async () => {
    const { container, rows } = createContainer()
    const service = createModuleConfigService(container)

    const written = await service.setValue('search', 'global_search_strategies', ['fulltext'])
    expect(written?.tenantId).toBeNull()
    expect(await service.getValue('search', 'global_search_strategies')).toEqual(['fulltext'])
    expect(rows).toHaveLength(1)
  })

  it('uses scope-aware cache keys', async () => {
    const { container, cacheKeys } = createContainer()
    const service = createModuleConfigService(container)

    await service.setValue('vector', 'embedding_config', { provider: 'global' })
    await service.getRecord('vector', 'embedding_config')
    await service.setValue('vector', 'embedding_config', { provider: 'tenant-a' }, { tenantId: TENANT_A })

    expect(cacheKeys()).toContain('module-config:v2:vector:embedding_config:global')
    expect(cacheKeys()).toContain(`module-config:v2:vector:embedding_config:${TENANT_A}`)
  })

  it('restoreDefaults seeds only the global row', async () => {
    const { container, rows } = createContainer()
    const service = createModuleConfigService(container)

    await service.restoreDefaults([{ moduleId: 'vector', name: 'embedding_config', value: { provider: 'default' } }])
    expect(rows).toHaveLength(1)
    expect(rows[0].tenantId).toBeNull()
    expect(await service.getValue('vector', 'embedding_config')).toEqual({ provider: 'default' })
  })
})
