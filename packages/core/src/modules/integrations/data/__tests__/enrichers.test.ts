import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  applyResponseEnrichers,
  applyResponseEnricherToRecord,
} from '@open-mercato/shared/lib/crud/enricher-runner'
import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import { enrichers } from '../enrichers'
import { SyncExternalIdMapping } from '../entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockedFindWithDecryption = jest.mocked(findWithDecryption)

beforeEach(() => {
  jest.clearAllMocks()
  registerResponseEnrichers([{ moduleId: 'integrations', enrichers }])
})

describe('external ID mapping response enricher', () => {
  it('enriches a concrete entity through the wildcard registry entry', async () => {
    const forkedEm = { id: 'forked-em' }
    const em = { fork: jest.fn(() => forkedEm) }
    const mapping = Object.assign(new SyncExternalIdMapping(), {
      id: 'mapping-1',
      integrationId: 'example-provider',
      internalEntityType: 'customers.person',
      internalEntityId: 'record-1',
      externalId: 'external-42',
      syncStatus: 'synced' as const,
      lastSyncedAt: new Date('2026-08-30T12:00:00.000Z'),
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    mockedFindWithDecryption.mockResolvedValue([mapping])

    const result = await applyResponseEnricherToRecord(
      { id: 'record-1', displayName: 'Ada Lovelace' },
      'customers.person',
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        userFeatures: ['integrations.view'],
        em,
        container: {},
      },
    )

    expect(mockedFindWithDecryption).toHaveBeenCalledWith(
      forkedEm,
      SyncExternalIdMapping,
      {
        internalEntityType: 'customers.person',
        internalEntityId: 'record-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      },
      undefined,
      { organizationId: 'org-1', tenantId: 'tenant-1' },
    )
    expect(result.record).toMatchObject({
      id: 'record-1',
      displayName: 'Ada Lovelace',
      _integrations: {
        'example-provider': {
          externalId: 'external-42',
          lastSyncedAt: '2026-08-30T12:00:00.000Z',
          syncStatus: 'synced',
        },
      },
    })
    expect(result._meta.enrichedBy).toEqual(['integrations.external-id-mapping'])
  })

  it('batch-enriches a concrete entity list through the wildcard registry entry', async () => {
    const forkedEm = { id: 'forked-em' }
    const em = { fork: jest.fn(() => forkedEm) }
    const mapping = Object.assign(new SyncExternalIdMapping(), {
      id: 'mapping-1',
      integrationId: 'example-provider',
      internalEntityType: 'customers.person',
      internalEntityId: 'record-1',
      externalId: 'external-42',
      syncStatus: 'synced' as const,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    mockedFindWithDecryption.mockResolvedValue([mapping])

    const result = await applyResponseEnrichers(
      [{ id: 'record-1' }, { id: 'record-2' }],
      'customers.person',
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        userFeatures: ['integrations.view'],
        em,
        container: {},
      },
    )

    expect(mockedFindWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockedFindWithDecryption).toHaveBeenCalledWith(
      forkedEm,
      SyncExternalIdMapping,
      expect.objectContaining({
        internalEntityType: 'customers.person',
        internalEntityId: { $in: ['record-1', 'record-2'] },
      }),
      undefined,
      { organizationId: 'org-1', tenantId: 'tenant-1' },
    )
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'record-1',
        _integrations: {
          'example-provider': expect.objectContaining({ externalId: 'external-42' }),
        },
      }),
      { id: 'record-2', _integrations: {} },
    ])
    expect(result._meta.enrichedBy).toEqual(['integrations.external-id-mapping'])
  })
})
