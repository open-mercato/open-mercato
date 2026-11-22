import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { decryptWithAesGcm, hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { reconcileLookupHashMaps } from '../reconcileLookupHashMaps'

const tenantId = randomUUID()
const organizationId = randomUUID()
const key = Buffer.alloc(32, 7).toString('base64')
const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv, LOOKUP_HASH_PEPPER: 'customer-lookup-test-pepper', TENANT_DATA_ENCRYPTION: 'true' }
})

afterEach(() => {
  process.env = originalEnv
})

it('adds hash rules to the persisted policies while preserving custom fields and writes context-free keyed digests', async () => {
  const maps = [
    {
      id: randomUUID(),
      entity_id: 'customers:customer_entity',
      tenant_id: tenantId,
      organization_id: organizationId,
      is_active: true,
      fields_json: [{ field: 'primary_email' }, { field: 'customer_custom_field' }],
    },
    {
      id: randomUUID(),
      entity_id: 'customers:customer_company_profile',
      tenant_id: tenantId,
      organization_id: organizationId,
      is_active: true,
      fields_json: [{ field: 'domain' }, { field: 'industry' }],
    },
    {
      id: randomUUID(),
      entity_id: 'customers:customer_address',
      tenant_id: tenantId,
      organization_id: organizationId,
      is_active: true,
      fields_json: [{ field: 'city' }],
    },
  ]
  const execute = jest.fn(async (sql: string, params: string[]) => {
    if (sql.startsWith('update encryption_maps')) {
      const map = maps.find(({ id }) => id === params[1])
      if (!map) throw new Error('Unexpected map update')
      map.fields_json = JSON.parse(params[0])
      return []
    }
    return maps.filter(({ entity_id }) => entity_id === params[0])
  })
  const em = { execute } as unknown as EntityManager

  await expect(reconcileLookupHashMaps(em, tenantId, organizationId)).resolves.toEqual(
    maps.slice(0, 2).map((map) => ({ entityId: map.entity_id, tenantId, organizationId })),
  )
  expect(maps.map((map) => map.fields_json)).toEqual([
    [{ field: 'primary_email', hashField: 'primary_email_hash' }, { field: 'customer_custom_field' }],
    [{ field: 'domain', hashField: 'domain_hash' }, { field: 'industry' }],
    [{ field: 'city' }],
  ])
  await expect(reconcileLookupHashMaps(em, tenantId, organizationId)).resolves.toEqual([])
  expect(execute.mock.calls.filter(([sql]) => sql.startsWith('update encryption_maps'))).toHaveLength(2)

  const service = new TenantDataEncryptionService(em, {
    kms: {
      isHealthy: () => true,
      getTenantDek: async () => ({ tenantId, key, fetchedAt: Date.now() }),
      createTenantDek: async () => null,
    },
  })
  for (const [entityId, field, hashField, plaintext] of [
    ['customers:customer_entity', 'primary_email', 'primary_email_hash', '  Owner@Example.COM  '],
    ['customers:customer_company_profile', 'domain', 'domain_hash', '  WWW.Example.COM  '],
  ]) {
    const result = await service.encryptEntityPayload(entityId, { [field]: plaintext }, tenantId, organizationId)
    expect(decryptWithAesGcm(String(result[field]), key)).toBe(plaintext)
    expect(result[hashField]).toBe(hashForLookup(plaintext))
    expect(result[hashField]).toMatch(/^v2:/)
    expect(result[hashField]).not.toBe(hashForLookup(plaintext, `${entityId}:${field}`))
  }
})

it('materializes the inherited map in the selected organization without changing the tenant policy', async () => {
  const inherited = {
    id: randomUUID(),
    organization_id: null,
    is_active: true,
    fields_json: [{ field: 'primary_email' }, { field: 'display_name' }],
  }
  const execute = jest.fn()
    .mockResolvedValueOnce([inherited])
    .mockResolvedValueOnce([{ id: randomUUID() }])
    .mockResolvedValueOnce([])
  await expect(reconcileLookupHashMaps({ execute } as unknown as EntityManager, tenantId, organizationId))
    .resolves.toEqual([{ entityId: 'customers:customer_entity', tenantId, organizationId }])
  expect(execute.mock.calls[1][0]).toContain('on conflict')
  expect(execute.mock.calls[1][1]).toEqual([
    'customers:customer_entity',
    tenantId,
    organizationId,
    JSON.stringify([{ field: 'primary_email', hashField: 'primary_email_hash' }, { field: 'display_name' }]),
  ])
  expect(inherited.fields_json).toEqual([{ field: 'primary_email' }, { field: 'display_name' }])
})

it('leaves inactive maps alone when no active fallback policy exists', async () => {
  const execute = jest.fn()
    .mockResolvedValueOnce([{ id: randomUUID(), organization_id: organizationId, is_active: false, fields_json: [{ field: 'primary_email' }] }])
    .mockResolvedValueOnce([])
  await expect(reconcileLookupHashMaps({ execute } as unknown as EntityManager, tenantId, organizationId)).resolves.toEqual([])
  expect(execute).toHaveBeenCalledTimes(2)
})

it('reports an inactive scope that prevents materializing the inherited policy', async () => {
  const execute = jest.fn().mockResolvedValueOnce([
    { id: randomUUID(), organization_id: organizationId, is_active: false, fields_json: [] },
    { id: randomUUID(), organization_id: null, is_active: true, fields_json: [{ field: 'primaryEmail' }] },
  ])
  await expect(reconcileLookupHashMaps({ execute } as unknown as EntityManager, tenantId, organizationId))
    .rejects.toThrow('An inactive organization encryption map')
  expect(execute).toHaveBeenCalledTimes(1)
})

it('reports a custom hash target without replacing it', async () => {
  const execute = jest.fn().mockResolvedValueOnce([
    { id: randomUUID(), organization_id: organizationId, is_active: true, fields_json: [{ field: 'primaryEmail', hashField: 'custom_digest' }] },
  ])
  await expect(reconcileLookupHashMaps({ execute } as unknown as EntityManager, tenantId, organizationId))
    .rejects.toThrow('uses a different hash column')
  expect(execute).toHaveBeenCalledTimes(1)
})

it('leaves a missing-pepper upgrade retryable without changing the map', async () => {
  delete process.env.LOOKUP_HASH_PEPPER
  delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
  delete process.env.TENANT_DATA_ENCRYPTION_KEY
  const execute = jest.fn().mockResolvedValueOnce([
    { id: randomUUID(), organization_id: organizationId, is_active: true, fields_json: [{ field: 'primary_email' }] },
  ])

  await expect(reconcileLookupHashMaps({ execute } as unknown as EntityManager, tenantId, organizationId))
    .rejects.toThrow('Configure LOOKUP_HASH_PEPPER')
  expect(execute).toHaveBeenCalledTimes(1)
})
