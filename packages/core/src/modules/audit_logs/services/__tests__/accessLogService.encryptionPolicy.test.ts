jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

import { AccessLogService, resetAccessLogRuntimeStateForTests } from '../accessLogService'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const fixedKey = Buffer.alloc(32, 7).toString('base64')

type MapRow = { entity_id: string; tenant_id: string | null; organization_id: string | null; fields_json: unknown }

function isPolicyRead(sql: string): boolean {
  return sql.includes('from encryption_maps')
}

function makeDatabase(mapRows: MapRow[]) {
  const policyReads: string[] = []
  const inserts: unknown[][] = []
  const execute = jest.fn(async (sql: string) => {
    if (isPolicyRead(sql)) {
      policyReads.push(sql)
      return mapRows.map((row) => ({ ...row }))
    }
    return []
  })
  const makeFork = () => ({
    execute,
    getConnection: () => ({
      execute: jest.fn(async (sql: string, params: unknown[]) => {
        inserts.push(params)
        return [{ id: '00000000-0000-4000-8000-000000000001' }]
      }),
    }),
    nativeDelete: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
  })
  const em = { fork: jest.fn(makeFork) }
  const serviceEm = { execute }
  return { em, serviceEm, policyReads, inserts }
}

function entry(index: number) {
  return {
    tenantId,
    organizationId,
    actorUserId,
    resourceKind: 'customers.company',
    resourceId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    accessType: 'read:list',
    fields: ['id', 'display_name'],
    context: { resultCount: 10 },
  }
}

describe('AccessLogService encryption-map reads (#8182)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION
  const mapRows: MapRow[] = [{
    entity_id: 'audit_logs:access_log',
    tenant_id: tenantId,
    organization_id: null,
    fields_json: [{ field: 'resource_id' }, { field: 'fields_json' }, { field: 'context_json' }],
  }]

  function wireEncryption(serviceEm: { execute: jest.Mock }) {
    const encryption = new TenantDataEncryptionService(serviceEm as never, {
      kms: {
        getTenantDek: jest.fn(async () => ({ tenantId, key: fixedKey, fetchedAt: Date.now() })),
        createTenantDek: jest.fn(async () => null),
        isHealthy: () => true,
      },
    } as never)
    ;(resolveTenantEncryptionService as jest.Mock).mockImplementation(() => encryption)
  }

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    resetAccessLogRuntimeStateForTests()
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('reads the access-log encryption map once for a whole batch and still encrypts every row', async () => {
    const { em, serviceEm, policyReads, inserts } = makeDatabase(mapRows)
    wireEncryption(serviceEm)
    const service = new AccessLogService(em as never)

    const written = await service.logMany(Array.from({ length: 10 }, (_, index) => entry(index)))

    expect(written).toBe(10)
    expect(policyReads).toHaveLength(1)
    expect(inserts).toHaveLength(1)
    const params = inserts[0]
    for (let row = 0; row < 10; row += 1) {
      const resourceId = params[row * 10 + 4]
      expect(resourceId).not.toBe(entry(row).resourceId)
      expect(String(resourceId)).toMatch(/:v1$/)
    }
  })

  it('reads the map once per single write, so a map change is seen by the next write', async () => {
    const { em, serviceEm, policyReads } = makeDatabase(mapRows)
    wireEncryption(serviceEm)
    const service = new AccessLogService(em as never)

    await service.log(entry(1))
    await service.log(entry(2))

    expect(policyReads).toHaveLength(2)
  })
})
