import handle, { metadata } from '../seed-tenant-encryption-maps'
import retryHandle, { metadata as retryMetadata } from '../seed-tenant-encryption-maps-retry'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'

const tenantId = 'new-tenant'

function makeContext(failInvalidation = false) {
  const execute = jest.fn(async (_sql: string, _params: unknown[]) => [{ id: 'map-1', updated_at: new Date() }])
  const em = { execute, fork: jest.fn(() => em) }
  const invalidateMap = jest.fn(async () => {
    if (failInvalidation) throw new Error('[internal] Cache unavailable')
  })
  return {
    em,
    invalidateMap,
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'tenantEncryptionService') return { invalidateMap } as T
      throw new Error(`[internal] Unexpected DI key: ${name}`)
    },
  }
}

describe('tenant encryption-map seeding (#7687)', () => {
  const previousEncryption = process.env.TENANT_DATA_ENCRYPTION
  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    registerModules([{
      id: 'test',
      defaultEncryptionMaps: [
        { entityId: 'test:record', fields: [{ field: 'secret' }] },
        { entityId: 'test:system', keyScope: 'system', fields: [{ field: 'secret' }] },
      ],
    }])
  })
  afterEach(() => {
    registerModules([])
    if (previousEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousEncryption
  })

  it('runs inline and uses the created record ID rather than the actor or global scope', async () => {
    const ctx = makeContext()
    await handle({ id: tenantId, tenantId: 'actor-tenant', organizationId: null }, ctx)
    expect(metadata).toMatchObject({ event: 'directory.tenant.created', persistent: false })
    expect(ctx.em.execute.mock.calls[0][1]).toEqual([
      'test:record', tenantId, null, JSON.stringify([{ field: 'secret', hashField: null }]), true,
    ])
    expect(ctx.invalidateMap).toHaveBeenCalledWith('test:record', tenantId, null)
    expect(ctx.em.execute.mock.calls.filter(([sql]) => sql.includes('insert into'))).toHaveLength(1)
  })

  it('has a durable retry using the same conflict-safe tenant upsert', async () => {
    const ctx = makeContext()
    await retryHandle({ id: tenantId, tenantId: null, organizationId: null }, ctx)
    expect(retryMetadata).toMatchObject({ event: metadata.event, persistent: true })
    expect(ctx.em.execute.mock.calls[0][0]).toContain('on conflict')
    expect(ctx.invalidateMap).toHaveBeenCalledWith('test:record', tenantId, null)
  })

  it.each([null, {}, { id: null }, { id: '' }, { tenantId: 'actor-tenant' }])('ignores malformed tenant creation payload %p', async (payload) => {
    const ctx = makeContext()
    await handle(payload, ctx)
    expect(ctx.em.fork).not.toHaveBeenCalled()
  })

  it('does not resolve services when encryption is disabled', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    const ctx = makeContext()
    await handle({ id: tenantId }, ctx)
    expect(ctx.em.fork).not.toHaveBeenCalled()
  })

  it('retains seeded policies when post-commit invalidation fails', async () => {
    const ctx = makeContext(true)
    await expect(handle({ id: tenantId }, ctx)).resolves.toBeUndefined()
    expect(ctx.em.execute.mock.calls[0][0]).toContain('insert into')
  })
})
