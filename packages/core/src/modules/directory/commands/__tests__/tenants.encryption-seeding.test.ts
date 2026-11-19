import '@open-mercato/core/modules/directory/commands/tenants'
import '@open-mercato/core/modules/directory/events'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { createEventBus } from '@open-mercato/events/bus'
import type { EntityManager } from '@mikro-orm/postgresql'
import seedTenant, { metadata } from '@open-mercato/core/modules/entities/subscribers/seed-tenant-encryption-maps'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'

jest.mock('@open-mercato/queue', () => ({
  createQueue: () => ({ enqueue: jest.fn(async () => {}) }),
}))

const tenantId = '22222222-2222-4222-8222-222222222222'
const actorTenantId = '11111111-1111-4111-8111-111111111111'

describe('directory tenant command encryption policies (#7687)', () => {
  const previousEncryption = process.env.TENANT_DATA_ENCRYPTION
  afterEach(() => {
    if (previousEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousEncryption
    registerModules([])
  })

  it('seeds the created tenant through real data-engine side effects with global event scope', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    registerModules([{ id: 'test', defaultEncryptionMaps: [{ entityId: 'test:record', fields: [{ field: 'secret' }] }] }])
    const execute = jest.fn(async (_sql: string, _params: unknown[]) => [{ id: 'map-1', updated_at: new Date() }])
    const em = { execute, fork: jest.fn(() => em) }
    const resolve = <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'dataEngine') return dataEngine as T
      if (name === 'eventBus') return eventBus as T
      if (name === 'kmsService') return { isHealthy: () => true, createTenantDek: async () => {} } as T
      if (name === 'tenantEncryptionService') return { invalidateMap: async () => {} } as T
      throw new Error(`[internal] Unexpected DI key: ${name}`)
    }
    const container = { resolve } as ConstructorParameters<typeof DefaultDataEngine>[1]
    const dataEngine = new DefaultDataEngine(em as unknown as EntityManager, container)
    const eventBus = createEventBus({ resolve, queueStrategy: 'local' })
    eventBus.on(metadata.event, seedTenant, metadata)
    const observedScopes: unknown[] = []
    eventBus.on(metadata.event, (_payload, ctx) => { observedScopes.push([ctx.tenantId, ctx.organizationId]) })
    const tenant = Object.assign(new Tenant(), { id: tenantId, name: 'New tenant' })
    jest.spyOn(dataEngine, 'createOrmEntity').mockResolvedValue(tenant)
    const ctx = {
      container,
      auth: { sub: 'superadmin', tenantId: actorTenantId, orgId: null, isSuperAdmin: true },
    } as unknown as Parameters<CommandHandler['execute']>[1]
    const command = commandRegistry.get('directory.tenants.create') as CommandHandler
    const created = await command.execute({ name: tenant.name }, ctx)
    await dataEngine.flushOrmEntityChanges({ skipReindex: true })

    expect(created).toBe(tenant)
    expect(observedScopes).toEqual([[null, null]])
    expect(execute.mock.calls[0][1]).toEqual([
      'test:record', tenantId, null, JSON.stringify([{ field: 'secret', hashField: null }]), true,
    ])
    expect(execute.mock.calls.flatMap(([, params]) => params)).not.toContain(actorTenantId)
  })
})
