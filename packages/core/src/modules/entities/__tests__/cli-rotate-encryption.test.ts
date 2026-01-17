/** @jest-environment node */
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

// Register mock entity IDs for the test
registerEntityIds({
  audit_logs: {
    access_log: 'audit_logs:access_log',
  },
} as any)

const execute = jest.fn()
const find = jest.fn()

jest.mock('@open-mercato/core/modules/entities/lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: jest.fn(async () => ({ processed: 0, synchronized: 0, fieldChanges: 0, skipped: 0 })),
  getAggregatedCustomEntityConfigs: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  decryptWithAesGcm: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => true,
    getDek: jest.fn(async (tenantId: string) => ({ tenantId, key: 'new-key', fetchedAt: 0 })),
    encryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => {
      const next: Record<string, unknown> = { ...payload }
      Object.entries(payload).forEach(([key, value]) => {
        if (typeof value === 'string') {
          next[key] = `enc:${value}`
        } else {
          next[key] = `enc:${JSON.stringify(value)}`
        }
      })
      return next
    }),
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({
      getConnection: () => ({ execute }),
      getMetadata: () => ({
        getAll: () => ([{
          className: 'AccessLog',
          name: 'AccessLog',
          tableName: 'access_logs',
          primaryKeys: ['id'],
          properties: {
            resourceId: {
              name: 'resourceId',
              fieldNames: ['resource_id'],
              columnTypes: ['text'],
              type: 'text',
            },
            contextJson: {
              name: 'contextJson',
              fieldNames: ['context_json'],
              columnTypes: ['jsonb'],
              type: 'jsonb',
            },
          },
        }]),
      }),
      find: (...args: any[]) => find(...args),
    }),
  }),
}))

describe('entities rotate-encryption-key CLI', () => {
  let cli: Array<{ command: string; run: (args: string[]) => Promise<void> }>

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    cli = require('@open-mercato/core/modules/entities/cli').default
  })

  it('rotates mapped fields with old key and updates rows', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    const encryptedValue = 'iv:cipher:tag:v1'

    find.mockImplementation(async (entity: any) => {
      if (entity === EncryptionMap) {
        return [{
          entityId: 'audit_logs:access_log',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          fieldsJson: [{ field: 'resource_id' }, { field: 'context_json' }],
          deletedAt: null,
        }]
      }
      if (entity === Organization) {
        return [{ id: 'org-1', tenantId: 'tenant-1' }]
      }
      return []
    })

    execute.mockResolvedValueOnce([
      { id: 'row-1', resource_id: encryptedValue, context_json: encryptedValue },
    ])
    ;(decryptWithAesGcm as jest.Mock)
      .mockReturnValueOnce('resource-value')
      .mockReturnValueOnce('{"note":"hello"}')

    await rotate.run(['--old-key', 'old-secret', '--tenant', 'tenant-1', '--org', 'org-1'])

    expect(decryptWithAesGcm).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(2)
    const updateCall = execute.mock.calls[1]
    expect(updateCall[0]).toMatch(/update\s+"access_logs"/)
    expect(updateCall[1]).toEqual(expect.arrayContaining([
      'enc:resource-value',
      '"enc:{\\"note\\":\\"hello\\"}"',
      'row-1',
    ]))
  })
})
