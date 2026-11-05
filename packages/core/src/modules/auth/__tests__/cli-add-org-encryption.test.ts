/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import seedTenant, { metadata as tenantMetadata } from '@open-mercato/core/modules/entities/subscribers/seed-tenant-encryption-maps'
import seedOrganization, { metadata as organizationMetadata } from '@open-mercato/core/modules/entities/subscribers/seed-organization-encryption-maps'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { createEventBus } from '@open-mercato/events/bus'
import type { EventBus } from '@open-mercato/events/types'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolve }),
}))
jest.mock('@open-mercato/core/modules/directory/lib/hierarchy', () => ({
  rebuildHierarchyForTenant: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/queue', () => ({
  createQueue: () => ({ enqueue: jest.fn(async () => {}) }),
}))

type MapRow = { entityId: string; tenantId: string; organizationId: string | null }
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
let mockBus: EventBus
let mockRows: MapRow[]
let mockFailSeed: boolean
let mockPersisted: Set<string>
const mockEm = {
  create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({
    ...data, id: entity === Tenant ? tenantId : organizationId,
  })),
  persist: jest.fn((entity: { id: string }) => ({
    flush: async () => { mockPersisted.add(entity.id) },
  })),
  fork: jest.fn(() => mockEm),
  execute: jest.fn(async (sql: string, params: unknown[]) => {
    if (mockFailSeed) throw new Error('[internal] Database unavailable')
    if (!sql.includes('insert into')) return []
    const [entityId, tenantId, organizationId] = params as [string, string, string | null]
    expect(mockPersisted.has(organizationId ?? tenantId)).toBe(true)
    mockRows.push({ entityId, tenantId, organizationId })
    return [{ id: `map-${mockRows.length}`, updated_at: new Date() }]
  }),
}
const mockResolve = <T = unknown>(name: string): T => {
  if (name === 'em') return mockEm as T
  if (name === 'eventBus') return mockBus as T
  if (name === 'tenantEncryptionService') return { invalidateMap: async () => {} } as T
  throw new Error(`[internal] Unexpected DI key: ${name}`)
}

const addOrganization = cli.find((command) => command.command === 'add-org')!

describe('auth add-org encryption lifecycle (#7687)', () => {
  const previousEncryption = process.env.TENANT_DATA_ENCRYPTION
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockRows = []
    mockPersisted = new Set()
    mockFailSeed = false
    registerModules([{ id: 'test', defaultEncryptionMaps: [{ entityId: 'test:record', fields: [{ field: 'secret' }] }] }])
    mockBus = createEventBus({ resolve: mockResolve, queueStrategy: 'local' })
    mockBus.on(tenantMetadata.event, seedTenant, tenantMetadata)
    mockBus.on(organizationMetadata.event, seedOrganization, organizationMetadata)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    if (previousEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousEncryption
    registerModules([])
    jest.clearAllMocks()
  })

  it('materializes tenant and organization policies before reporting CLI success', async () => {
    await addOrganization.run(['--name', 'Encryption regression'])

    expect(mockRows).toEqual([
      { entityId: 'test:record', tenantId, organizationId: null },
      { entityId: 'test:record', tenantId, organizationId },
    ])
    expect(mockEm.create.mock.calls.find(([entity]) => entity === Organization)?.[1]).toMatchObject({ logoPreserveAspectRatio: false })
    expect(logSpy).toHaveBeenCalledWith('Organization created with id', organizationId, 'in tenant', tenantId)
  })

  it('preserves add-org when encryption is disabled', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    await addOrganization.run(['--orgName', 'Unencrypted regression'])
    expect(mockRows).toEqual([])
    expect(mockPersisted).toEqual(new Set([tenantId, organizationId]))
  })

  it('keeps provisioning independent of the entities module', async () => {
    registerModules([])
    mockBus = createEventBus({ resolve: mockResolve, queueStrategy: 'local' })
    await addOrganization.run(['--name', 'No optional subscribers'])
    expect(mockPersisted).toEqual(new Set([tenantId, organizationId]))
    expect(logSpy).toHaveBeenCalledWith('Organization created with id', organizationId, 'in tenant', tenantId)
  })

  it('rejects instead of announcing success when inline seeding fails', async () => {
    mockFailSeed = true
    await expect(addOrganization.run(['--name', 'Failed seed'])).rejects.toThrow('Database unavailable')
    expect(mockPersisted.has(organizationId)).toBe(false)
    expect(logSpy).not.toHaveBeenCalled()
  })
})
