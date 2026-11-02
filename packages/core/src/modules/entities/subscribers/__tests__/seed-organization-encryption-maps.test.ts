// Regression test for #7591: an organization created after `mercato init` got no
// `encryption_maps` row, so its mapped fields were written as plaintext while the
// init organization stayed encrypted. This subscriber seeds the same default maps
// for every newly-created organization.

import handler, { metadata } from '@open-mercato/core/modules/entities/subscribers/seed-organization-encryption-maps'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

const TEST_ENTITY_ID = 'test_org_encryption_seed:thing'

const testModules: Module[] = [
  {
    id: 'test_org_encryption_seed',
    defaultEncryptionMaps: [{ entityId: TEST_ENTITY_ID, fields: [{ field: 'secret' }] }],
  } as Module,
]

function makeEm(execute: jest.Mock) {
  const em = { execute } as unknown as { execute: jest.Mock; fork: jest.Mock }
  em.fork = jest.fn(() => em)
  return em
}

function makeCtx(options: { em: ReturnType<typeof makeEm>; invalidateMap?: jest.Mock }) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return options.em as unknown as T
      if (name === 'tenantEncryptionService') {
        return { invalidateMap: options.invalidateMap ?? jest.fn(async () => {}) } as unknown as T
      }
      throw new Error(`unexpected DI key: ${name}`)
    },
  }
}

describe('entities/seed-organization-encryption-maps subscriber', () => {
  const originalEnv = process.env.TENANT_DATA_ENCRYPTION

  beforeAll(() => {
    registerModules(testModules)
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalEnv
  })

  it('declares the directory.organization.created event as ephemeral (inline delivery)', () => {
    // Must stay `persistent: false` so this subscriber runs inline, before the
    // directory.organizations.create request returns — a persistent-marked subscriber only
    // runs in the events worker under single-delivery (the default), reopening #7591's
    // plaintext-write window. See the sibling `*-retry.ts` subscriber for the persistent
    // backstop.
    expect(metadata.event).toBe('directory.organization.created')
    expect(metadata.persistent).toBe(false)
  })

  it('seeds the default encryption maps for the new organization scope and invalidates the cache', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const execute = jest.fn(async () => [{ id: 'map-id-1', updated_at: new Date() }])
    const em = makeEm(execute)
    const invalidateMap = jest.fn(async () => {})
    const tenantId = 'tenant-1'
    const organizationId = 'org-1'

    await handler({ id: organizationId, tenantId, organizationId }, makeCtx({ em, invalidateMap }))

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    const [, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(params).toEqual([TEST_ENTITY_ID, tenantId, organizationId, JSON.stringify([{ field: 'secret', hashField: null }]), true])

    expect(invalidateMap).toHaveBeenCalledWith(TEST_ENTITY_ID, tenantId, organizationId)
  })

  it('is a no-op when TENANT_DATA_ENCRYPTION is disabled', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    const execute = jest.fn(async () => [{ id: 'map-id-1', updated_at: new Date() }])
    const em = makeEm(execute)

    await handler({ id: 'org-1', tenantId: 'tenant-1', organizationId: 'org-1' }, makeCtx({ em }))

    expect(execute).not.toHaveBeenCalled()
  })

  it('is a no-op when the payload is missing tenantId or organizationId', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const execute = jest.fn(async () => [{ id: 'map-id-1', updated_at: new Date() }])
    const em = makeEm(execute)

    await handler({ id: 'org-1', organizationId: 'org-1' }, makeCtx({ em }))
    await handler({ id: 'org-1', tenantId: 'tenant-1' }, makeCtx({ em }))

    expect(execute).not.toHaveBeenCalled()
  })

  it('still seeds the maps when the post-seed cache invalidation fails', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const execute = jest.fn(async () => [{ id: 'map-id-1', updated_at: new Date() }])
    const em = makeEm(execute)
    const invalidateMap = jest.fn(async () => {
      throw new Error('cache backend down')
    })

    await expect(
      handler({ id: 'org-2', tenantId: 'tenant-1', organizationId: 'org-2' }, makeCtx({ em, invalidateMap })),
    ).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledTimes(1)
  })
})
