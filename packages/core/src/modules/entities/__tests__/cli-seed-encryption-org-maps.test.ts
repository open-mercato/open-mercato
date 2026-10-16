/** @jest-environment node */
const upsertCanonicalEncryptionMap = jest.fn(async () => ({ id: 'map-id', updatedAt: new Date() }))
const appendMissingFieldsToOrganizationMaps = jest.fn()

jest.mock('@open-mercato/core/modules/entities/lib/encryption-maps', () => ({
  upsertCanonicalEncryptionMap: (...args: unknown[]) => upsertCanonicalEncryptionMap(...(args as [])),
  appendMissingFieldsToOrganizationMaps: (...args: unknown[]) => appendMissingFieldsToOrganizationMaps(...args),
}))

jest.mock('@open-mercato/core/modules/entities/lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: jest.fn(async () => ({ processed: 0, synchronized: 0, fieldChanges: 0, skipped: 0 })),
  getAggregatedCustomEntityConfigs: jest.fn(() => []),
}))

import { upsertEncryptionMapSpecs } from '../cli'

const em = {} as never
const spec = { entityId: 'fleet:vehicle_profile', fields: [{ field: 'email' }, { field: 'phone' }] }

describe('upsertEncryptionMapSpecs organization maps', () => {
  beforeEach(() => {
    upsertCanonicalEncryptionMap.mockClear()
    appendMissingFieldsToOrganizationMaps.mockReset()
  })

  it('brings the tenant organization maps up to date on a tenant-wide seed and reports them for invalidation', async () => {
    appendMissingFieldsToOrganizationMaps.mockResolvedValue([
      { entityId: 'fleet:vehicle_profile', tenantId: 'tenant-1', organizationId: 'org-1' },
    ])
    const invalidated: unknown[] = []

    const scopes = await upsertEncryptionMapSpecs(em, 'tenant-1', null, [spec], () => {}, (scope) => {
      invalidated.push(scope)
    })

    expect(appendMissingFieldsToOrganizationMaps).toHaveBeenCalledWith(em, {
      entityId: 'fleet:vehicle_profile',
      tenantId: 'tenant-1',
      fields: spec.fields,
    })
    const expected = [
      { entityId: 'fleet:vehicle_profile', tenantId: 'tenant-1', organizationId: null },
      { entityId: 'fleet:vehicle_profile', tenantId: 'tenant-1', organizationId: 'org-1' },
    ]
    expect(scopes).toEqual(expected)
    expect(invalidated).toEqual(expected)
  })

  it('leaves other organizations alone when seeding one organization', async () => {
    const scopes = await upsertEncryptionMapSpecs(em, 'tenant-1', 'org-2', [spec])

    expect(appendMissingFieldsToOrganizationMaps).not.toHaveBeenCalled()
    expect(scopes).toEqual([{ entityId: 'fleet:vehicle_profile', tenantId: 'tenant-1', organizationId: 'org-2' }])
  })

  it('skips system-scoped maps entirely', async () => {
    await upsertEncryptionMapSpecs(em, 'tenant-1', null, [{ ...spec, keyScope: 'system' }])

    expect(upsertCanonicalEncryptionMap).not.toHaveBeenCalled()
    expect(appendMissingFieldsToOrganizationMaps).not.toHaveBeenCalled()
  })
})
