/** @jest-environment node */
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

registerEntityIds({
  onboarding: {
    onboarding_request: 'onboarding:onboarding_request',
  },
} as any)

const execute = jest.fn(async () => [])
const find = jest.fn()
const create = jest.fn((_entity: unknown, data: Record<string, unknown>) => data)
const persist = jest.fn(() => ({ flush: jest.fn(async () => {}) }))
const findOne = jest.fn(async () => null)

const declaredMaps = [
  {
    entityId: 'onboarding:onboarding_request',
    keyScope: 'system',
    fields: [{ field: 'email', hashField: 'email_hash' }],
  },
  {
    entityId: 'customers:person',
    keyScope: 'tenant',
    fields: [{ field: 'email', hashField: 'email_hash' }],
  },
]

jest.mock('@open-mercato/core/modules/entities/lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: jest.fn(async () => ({ processed: 0, synchronized: 0, fieldChanges: 0, skipped: 0 })),
  getAggregatedCustomEntityConfigs: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/modules/registry', () => ({
  getCliModules: () => [{ id: 'onboarding' }],
  getDefaultEncryptionMaps: () => declaredMaps,
}))

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => true,
    getDek: jest.fn(async (tenantId: string) => ({ tenantId, key: 'tenant-key', fetchedAt: 0 })),
    encryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => payload),
  })),
  parseDecryptedFieldValue: (decrypted: string) => decrypted,
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({
      getConnection: () => ({ execute }),
      getMetadata: () => ({
        getAll: () => ([{
          className: 'OnboardingRequest',
          name: 'OnboardingRequest',
          tableName: 'onboarding_requests',
          primaryKeys: ['id'],
          properties: {
            id: { name: 'id', fieldNames: ['id'], columnTypes: ['uuid'], type: 'uuid' },
            email: { name: 'email', fieldNames: ['email'], columnTypes: ['text'], type: 'text' },
          },
        }]),
      }),
      find: (...args: unknown[]) => find(...args),
      findOne: (...args: unknown[]) => findOne(...(args as [])),
      create: (...args: unknown[]) => create(...(args as [unknown, Record<string, unknown>])),
      persist: (...args: unknown[]) => persist(...(args as [])),
    }),
  }),
}))

function loadCommand(name: string) {
  const cli = require('@open-mercato/core/modules/entities/cli').default as Array<{ command: string; run: (args: string[]) => Promise<void> }>
  return cli.find((entry) => entry.command === name)!
}

describe('entities CLI system-scope guards', () => {
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('rotate-encryption-key refuses to re-wrap a system-scoped entity under a tenant key', async () => {
    find.mockImplementation(async (entity: unknown) => {
      if (entity === EncryptionMap) {
        return [{
          entityId: 'onboarding:onboarding_request',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          fieldsJson: [{ field: 'email', hashField: 'email_hash' }],
          deletedAt: null,
        }]
      }
      return []
    })

    await loadCommand('rotate-encryption-key').run(['--old-key', 'old-secret', '--tenant', 'tenant-1'])

    expect(execute).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.flat().join('\n')).toContain('Skipping onboarding:onboarding_request: system-scoped entity')
    expect(logSpy.mock.calls.flat().join('\n')).toContain('No encryption maps found for the selected scope.')
  })

  it('decrypt-database leaves system-scoped rows untouched', async () => {
    find.mockImplementation(async (entity: unknown) => {
      if (entity === EncryptionMap) {
        return [{
          entityId: 'onboarding:onboarding_request',
          tenantId: 'tenant-1',
          organizationId: null,
          fieldsJson: [{ field: 'email', hashField: 'email_hash' }],
          isActive: true,
          deletedAt: null,
        }]
      }
      return []
    })

    await loadCommand('decrypt-database').run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    expect(execute).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.flat().join('\n')).toContain('Skipping onboarding:onboarding_request: system-scoped entity')
    expect(logSpy.mock.calls.flat().join('\n')).toContain('No active encryption maps found for the selected scope.')
  })

  it('seed-encryption persists tenant-scoped maps only', async () => {
    await loadCommand('seed-encryption').run(['--tenant', 'tenant-1'])

    const persistedEntityIds = create.mock.calls.map(([, data]) => data.entityId)
    expect(persistedEntityIds).toEqual(['customers:person'])
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Skipping onboarding:onboarding_request: system-scoped map')
  })
})
