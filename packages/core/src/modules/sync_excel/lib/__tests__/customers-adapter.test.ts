import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  buildPersonPayload,
  parseCursor,
  syncExcelCustomersAdapter,
} from '../adapters/customers'

const mockReadSyncExcelUploadBuffer = jest.fn()
const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const mockCommandBus = {
  execute: jest.fn(),
}

const mockExternalIdMappingService = {
  lookupLocalId: jest.fn(),
  storeExternalIdMapping: jest.fn(),
}

const uploadRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  attachmentId: '22222222-2222-4222-8222-222222222222',
  status: 'uploaded',
  syncRunId: null as string | null,
}

const mappingRecord = {
  mapping: {
    entityType: 'customers.person',
    matchStrategy: 'externalId',
    matchField: 'person.externalId',
    fields: [
      { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id', dedupeRole: 'primary' },
      { externalField: 'First Name', localField: 'person.firstName', mappingKind: 'core' },
      { externalField: 'Last Name', localField: 'person.lastName', mappingKind: 'core' },
      { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
      { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
      { externalField: 'Address Line 1', localField: 'address.addressLine1', mappingKind: 'core' },
      { externalField: 'City', localField: 'address.city', mappingKind: 'core' },
      { externalField: 'Postal Code', localField: 'address.postalCode', mappingKind: 'core' },
      { externalField: 'Favorite Color', localField: 'cf:favorite_color', mappingKind: 'custom_field' },
    ],
  },
}

const mockEm = {
  findOne: jest.fn(),
  find: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'commandBus') return mockCommandBus
    if (token === 'externalIdMappingService') return mockExternalIdMappingService
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('../upload-storage', () => ({
  readSyncExcelUploadBuffer: (...args: unknown[]) => mockReadSyncExcelUploadBuffer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

describe('sync_excel customers adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    uploadRecord.status = 'uploaded'
    uploadRecord.syncRunId = null
    mockEm.findOne.mockImplementation(async (_entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.syncRunId === 'run-1') return uploadRecord
      if (criteria?.id === uploadRecord.id) return uploadRecord
      if (criteria?.id === uploadRecord.attachmentId) {
        return {
          id: uploadRecord.attachmentId,
          partitionCode: 'privateAttachments',
          storagePath: 'uploads/leads.csv',
          storageDriver: 'local',
        }
      }
      if (criteria?.integrationId === 'sync_excel') return mappingRecord
      return null
    })
    mockEm.find.mockResolvedValue([])
    mockReadSyncExcelUploadBuffer.mockResolvedValue(Buffer.from([
      'Record Id,First Name,Last Name,Lead Name,Email,Address Line 1,City,Postal Code,Favorite Color',
      'ext-1,Ada,Lovelace,Ada Lovelace,ada@example.com,123 Main St,Austin,78701,Blue',
    ].join('\n')))
    mockExternalIdMappingService.lookupLocalId.mockResolvedValue(null)
    mockExternalIdMappingService.storeExternalIdMapping.mockResolvedValue(undefined)
    mockCommandBus.execute.mockResolvedValue({
      result: {
        entityId: '33333333-3333-4333-8333-333333333333',
        personId: '44444444-4444-4444-8444-444444444444',
      },
    })
    mockFindOneWithDecryption.mockImplementation(async (_entityManager: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.syncRunId === 'run-1') return uploadRecord as any
      if (criteria?.id === uploadRecord.id) return uploadRecord as any
      if (criteria?.id === uploadRecord.attachmentId) {
        return {
          id: uploadRecord.attachmentId,
          partitionCode: 'privateAttachments',
          storagePath: 'uploads/leads.csv',
          storageDriver: 'local',
        } as any
      }
      if (criteria?.integrationId === 'sync_excel') return mappingRecord as any
      return null
    })
    mockFindWithDecryption.mockImplementation(async (_entityManager: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.entityId) return []
      if (criteria?.kind === 'person') return []
      if (criteria?.isPrimary) return []
      return []
    })
  })

  it('parses persisted cursors without retaining inline payloads', () => {
    expect(parseCursor('{"uploadId":"abc","offset":12}')).toEqual({ uploadId: 'abc', offset: 12 })
    expect(parseCursor('{"uploadId":"abc","offset":12,"inlineCsvBase64":"YWJj"}')).toEqual({
      uploadId: 'abc',
      offset: 12,
    })
    expect(parseCursor('not-json')).toBeNull()
  })

  it('builds create payloads from mapped rows', () => {
    const payload = buildPersonPayload(
      {
        'Record Id': 'ext-1',
        'Lead Name': 'Ada Lovelace',
        Email: 'ADA@example.com',
        'Address Line 1': '123 Main St',
        City: 'Austin',
        'Postal Code': '78701',
        'Favorite Color': 'Blue',
      },
      mappingRecord.mapping as any,
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    )

    expect(payload.values.externalId).toBe('ext-1')
    expect(payload.values.primaryEmail).toBe('ada@example.com')
    expect(payload.customFields).toEqual({ favorite_color: 'Blue' })
    expect(payload.addressValues).toEqual({
      addressLine1: '123 Main St',
      city: 'Austin',
      postalCode: '78701',
    })
    expect(payload.createInput).toMatchObject({
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      displayName: 'Ada Lovelace',
      primaryEmail: 'ada@example.com',
    })
  })

  it('normalizes import phone numbers with a known country before building payloads', () => {
    const payload = buildPersonPayload(
      {
        'Record Id': 'ext-2',
        'Lead Name': 'Paul Sullivan',
        Email: 'psullivan@revenueml.com',
        Mobile: '416-893-2731',
        Country: 'Canada',
      },
      {
        entityType: 'customers.person',
        matchStrategy: 'email',
        matchField: 'person.primaryEmail',
        fields: [
          { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id', dedupeRole: 'primary' },
          { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
          { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
          { externalField: 'Mobile', localField: 'person.primaryPhone', mappingKind: 'core' },
        ],
      } as any,
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    )

    expect(payload.values.primaryPhone).toBe('+14168932731')
    expect(payload.createInput).toMatchObject({
      primaryPhone: '+14168932731',
    })
  })

  it('drops invalid optional phones instead of failing the row payload', () => {
    const payload = buildPersonPayload(
      {
        'Record Id': 'ext-3',
        'Lead Name': 'Ben Example',
        Email: 'ben@example.com',
        Mobile: '98.50197.00',
      },
      {
        entityType: 'customers.person',
        matchStrategy: 'email',
        matchField: 'person.primaryEmail',
        fields: [
          { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id', dedupeRole: 'primary' },
          { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
          { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
          { externalField: 'Mobile', localField: 'person.primaryPhone', mappingKind: 'core' },
        ],
      } as any,
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    )

    expect(payload.values.primaryPhone).toBeNull()
    expect(payload.createInput).toEqual(expect.not.objectContaining({
      primaryPhone: expect.anything(),
    }))
  })

  it('imports rows and creates people with external-id mappings', async () => {
    const batches = []
    for await (const batch of syncExcelCustomersAdapter.streamImport!({
      entityType: 'customers.person',
      batchSize: 50,
      credentials: {},
      mapping: mappingRecord.mapping as any,
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      runId: 'run-1',
    })) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({
      totalEstimate: 1,
      processedCount: 1,
      hasMore: false,
      refreshCoverageEntityTypes: expect.arrayContaining([
        'customers:customer_entity',
        'customers:customer_person_profile',
        'customers:customer_address',
      ]),
    })
    expect(batches[0].items[0]).toMatchObject({
      externalId: 'ext-1',
      action: 'create',
      data: expect.objectContaining({
        localId: '33333333-3333-4333-8333-333333333333',
        sourceIdentifier: 'ext-1',
      }),
    })
    expect(mockCommandBus.execute).toHaveBeenCalledWith('customers.people.create', expect.objectContaining({
      input: expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: 'Ada Lovelace',
        primaryEmail: 'ada@example.com',
        customFields: {
          favorite_color: 'Blue',
        },
      }),
      ctx: expect.objectContaining({
        auth: null,
      }),
    }))
    expect(mockCommandBus.execute).toHaveBeenCalledWith('customers.addresses.create', expect.objectContaining({
      input: expect.objectContaining({
        entityId: '33333333-3333-4333-8333-333333333333',
        addressLine1: '123 Main St',
        city: 'Austin',
        postalCode: '78701',
        isPrimary: true,
      }),
      ctx: expect.objectContaining({
        auth: null,
      }),
    }))
    expect(mockExternalIdMappingService.storeExternalIdMapping).toHaveBeenCalledWith(
      'sync_excel',
      'customers.person',
      '33333333-3333-4333-8333-333333333333',
      'ext-1',
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    )
    expect(uploadRecord.status).toBe('completed')
  })

  it('imports rows from attachment storage and keeps payloads out of cursors', async () => {
    const batches = []
    for await (const batch of syncExcelCustomersAdapter.streamImport!({
      entityType: 'customers.person',
      batchSize: 50,
      credentials: {},
      mapping: mappingRecord.mapping as any,
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      runId: 'run-1',
      cursor: JSON.stringify({
        uploadId: uploadRecord.id,
        offset: 0,
        inlineCsvBase64: Buffer.from('legacy').toString('base64'),
      }),
    })) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(1)
    expect(mockReadSyncExcelUploadBuffer).toHaveBeenCalledWith(expect.objectContaining({
      id: uploadRecord.attachmentId,
    }))
    expect(JSON.parse(String(batches[0].cursor))).toEqual({
      uploadId: uploadRecord.id,
      offset: 1,
    })
  })


  it('falls back to email dedupe and updates existing people', async () => {
    mockReadSyncExcelUploadBuffer.mockResolvedValue(Buffer.from([
      'Email,Lead Name,Address Line 1,City,Favorite Color',
      'ada@example.com,Ada Lovelace,500 Updated Ave,Dallas,Purple',
    ].join('\n')))
    mockFindOneWithDecryption.mockImplementation(async (_entityManager: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.syncRunId === 'run-1') return uploadRecord as any
      if (criteria?.id === uploadRecord.attachmentId) {
        return {
          id: uploadRecord.attachmentId,
          partitionCode: 'privateAttachments',
          storagePath: 'uploads/leads.csv',
          storageDriver: 'local',
        } as any
      }
      return null
    })
    mockCommandBus.execute.mockResolvedValue({ result: { entityId: 'existing-person-id' } })
    mockFindWithDecryption.mockImplementation(async (_entityManager: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.entityId) return []
      if (criteria?.kind === 'person') {
        return [
          {
            id: 'existing-person-id',
            primaryEmail: 'Ada@Example.com',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          } as any,
          {
            id: 'newer-person-id',
            primaryEmail: 'ada@example.com',
            createdAt: new Date('2024-02-01T00:00:00.000Z'),
          } as any,
        ]
      }
      if (criteria?.isPrimary) {
        return [
          {
            id: 'existing-primary-address-id',
          } as any,
        ]
      }
      return []
    })

    const batches = []
    for await (const batch of syncExcelCustomersAdapter.streamImport!({
      entityType: 'customers.person',
      batchSize: 50,
      credentials: {},
      mapping: {
        entityType: 'customers.person',
        matchStrategy: 'email',
        matchField: 'person.primaryEmail',
        fields: [
          { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
          { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
          { externalField: 'Address Line 1', localField: 'address.addressLine1', mappingKind: 'core' },
          { externalField: 'City', localField: 'address.city', mappingKind: 'core' },
          { externalField: 'Favorite Color', localField: 'cf:favorite_color', mappingKind: 'custom_field' },
        ],
      },
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      runId: 'run-1',
    })) {
      batches.push(batch)
    }

    expect(batches[0].items[0]).toMatchObject({
      action: 'update',
      data: expect.objectContaining({
        localId: 'existing-person-id',
      }),
    })
    expect(mockCommandBus.execute).toHaveBeenCalledWith('customers.people.update', expect.objectContaining({
      input: expect.objectContaining({
        id: 'existing-person-id',
        primaryEmail: 'ada@example.com',
        displayName: 'Ada Lovelace',
        customFields: {
          favorite_color: 'Purple',
        },
      }),
      ctx: expect.objectContaining({
        auth: null,
      }),
    }))
    expect(mockCommandBus.execute).toHaveBeenCalledWith('customers.addresses.update', expect.objectContaining({
      input: expect.objectContaining({
        id: 'existing-primary-address-id',
        addressLine1: '500 Updated Ave',
        city: 'Dallas',
        isPrimary: true,
      }),
      ctx: expect.objectContaining({
        auth: null,
      }),
    }))
    expect(mockFindOneWithDecryption).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ primaryEmail: 'ada@example.com' }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('prefers external-id mappings over decrypted email fallback matches', async () => {
    mockReadSyncExcelUploadBuffer.mockResolvedValue(Buffer.from([
      'Record Id,Email,Lead Name',
      'ext-existing,ada@example.com,Ada Lovelace',
    ].join('\n')))
    mockExternalIdMappingService.lookupLocalId.mockResolvedValueOnce('external-existing-id')
    mockFindWithDecryption.mockImplementation(async (_entityManager: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.entityId) return []
      if (criteria?.kind === 'person') {
        return [
          {
            id: 'email-existing-id',
            primaryEmail: 'ada@example.com',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          } as any,
        ]
      }
      return []
    })
    mockCommandBus.execute.mockResolvedValue({ result: { entityId: 'external-existing-id' } })

    const batches = []
    for await (const batch of syncExcelCustomersAdapter.streamImport!({
      entityType: 'customers.person',
      batchSize: 50,
      credentials: {},
      mapping: {
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        matchField: 'person.externalId',
        fields: [
          { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id', dedupeRole: 'primary' },
          { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
          { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
        ],
      },
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      runId: 'run-1',
    })) {
      batches.push(batch)
    }

    expect(batches[0].items[0]).toMatchObject({
      action: 'update',
      data: expect.objectContaining({
        localId: 'external-existing-id',
      }),
    })
    expect(mockCommandBus.execute).toHaveBeenCalledWith('customers.people.update', expect.objectContaining({
      input: expect.objectContaining({
        id: 'external-existing-id',
      }),
    }))
  })

  it('coerces typed custom fields before creating people', async () => {
    mockReadSyncExcelUploadBuffer.mockResolvedValue(Buffer.from([
      'Email,Lead Name,Newsletter,Score,Ratio,Start Date',
      'ada@example.com,Ada Lovelace,tak,42,3.14,2026-05-13',
    ].join('\n')))
    mockFindWithDecryption.mockImplementation(async (_entityManager: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.entityId) {
        return [
          { key: 'newsletter', kind: 'boolean', entityId: 'customers:customer_entity', organizationId: 'org-1', tenantId: 'tenant-1' } as any,
          { key: 'score', kind: 'integer', entityId: 'customers:customer_entity', organizationId: 'org-1', tenantId: 'tenant-1' } as any,
          { key: 'ratio', kind: 'float', entityId: 'customers:customer_person_profile', organizationId: 'org-1', tenantId: 'tenant-1' } as any,
          { key: 'start_date', kind: 'date', entityId: 'customers:customer_person_profile', organizationId: 'org-1', tenantId: 'tenant-1' } as any,
        ]
      }
      if (criteria?.kind === 'person') return []
      return []
    })

    const batches = []
    for await (const batch of syncExcelCustomersAdapter.streamImport!({
      entityType: 'customers.person',
      batchSize: 50,
      credentials: {},
      mapping: {
        entityType: 'customers.person',
        matchStrategy: 'email',
        matchField: 'person.primaryEmail',
        fields: [
          { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
          { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
          { externalField: 'Newsletter', localField: 'cf:newsletter', mappingKind: 'custom_field' },
          { externalField: 'Score', localField: 'cf:score', mappingKind: 'custom_field' },
          { externalField: 'Ratio', localField: 'cf:ratio', mappingKind: 'custom_field' },
          { externalField: 'Start Date', localField: 'cf:start_date', mappingKind: 'custom_field' },
        ],
      },
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      runId: 'run-1',
    })) {
      batches.push(batch)
    }

    expect(batches[0].items[0]).toMatchObject({ action: 'create' })
    expect(mockCommandBus.execute).toHaveBeenCalledWith('customers.people.create', expect.objectContaining({
      input: expect.objectContaining({
        customFields: {
          newsletter: true,
          score: 42,
          ratio: 3.14,
          start_date: '2026-05-13',
        },
      }),
    }))
  })

  it('fails only the row when a typed custom field value cannot be coerced', async () => {
    mockReadSyncExcelUploadBuffer.mockResolvedValue(Buffer.from([
      'Email,Lead Name,Newsletter',
      'ada@example.com,Ada Lovelace,perhaps',
    ].join('\n')))
    mockFindWithDecryption.mockImplementation(async (_entityManager: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.entityId) {
        return [
          { key: 'newsletter', kind: 'boolean', entityId: 'customers:customer_entity', organizationId: 'org-1', tenantId: 'tenant-1' } as any,
        ]
      }
      if (criteria?.kind === 'person') return []
      return []
    })

    const batches = []
    for await (const batch of syncExcelCustomersAdapter.streamImport!({
      entityType: 'customers.person',
      batchSize: 50,
      credentials: {},
      mapping: {
        entityType: 'customers.person',
        matchStrategy: 'email',
        matchField: 'person.primaryEmail',
        fields: [
          { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
          { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
          { externalField: 'Newsletter', localField: 'cf:newsletter', mappingKind: 'custom_field' },
        ],
      },
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      runId: 'run-1',
    })) {
      batches.push(batch)
    }

    expect(batches[0].items[0]).toMatchObject({
      action: 'failed',
      data: expect.objectContaining({
        errorMessage: 'Custom field "newsletter" expects a boolean value.',
      }),
    })
    expect(mockCommandBus.execute).not.toHaveBeenCalledWith('customers.people.create', expect.anything())
  })

  it('skips address upsert when mapped address values are missing address line 1', async () => {
    mockReadSyncExcelUploadBuffer.mockResolvedValue(Buffer.from([
      'Record Id,First Name,Last Name,Email,City',
      'ext-2,Grace,Hopper,grace@example.com,Arlington',
    ].join('\n')))

    const batches = []
    for await (const batch of syncExcelCustomersAdapter.streamImport!({
      entityType: 'customers.person',
      batchSize: 50,
      credentials: {},
      mapping: {
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        matchField: 'person.externalId',
        fields: [
          { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id', dedupeRole: 'primary' },
          { externalField: 'First Name', localField: 'person.firstName', mappingKind: 'core' },
          { externalField: 'Last Name', localField: 'person.lastName', mappingKind: 'core' },
          { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
          { externalField: 'City', localField: 'address.city', mappingKind: 'core' },
        ],
      },
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      runId: 'run-1',
    })) {
      batches.push(batch)
    }

    expect(batches[0].items[0]).toMatchObject({
      action: 'create',
      externalId: 'ext-2',
    })
    expect(mockCommandBus.execute).toHaveBeenCalledWith('customers.people.create', expect.anything())
    expect(mockCommandBus.execute).not.toHaveBeenCalledWith('customers.addresses.create', expect.anything())
    expect(mockCommandBus.execute).not.toHaveBeenCalledWith('customers.addresses.update', expect.anything())
  })
})
