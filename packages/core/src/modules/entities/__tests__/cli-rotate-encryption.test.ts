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

const getDek = jest.fn()
const encryptEntityPayload = jest.fn()

const defaultGetDek = async (tenantId: string) => ({ tenantId, key: 'new-key', fetchedAt: 0 })
const defaultEncryptEntityPayload = async (_entityId: string, payload: Record<string, unknown>) => {
  const next: Record<string, unknown> = { ...payload }
  Object.entries(payload).forEach(([key, value]) => {
    if (typeof value === 'string') {
      next[key] = `enc:${value}`
    } else {
      next[key] = `enc:${JSON.stringify(value)}`
    }
  })
  return next
}

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => true,
    getDek: (...args: unknown[]) => getDek(...args),
    encryptEntityPayload: (...args: unknown[]) => encryptEntityPayload(...args),
  })),
  resolveEncryptionKeyId: (entityId: string, keyScope: string | undefined, tenantId: string | null | undefined) =>
    (keyScope === 'system' ? `system:${entityId}` : tenantId ?? null),
  parseDecryptedFieldValue: (decrypted: string) => {
    if (decrypted.length === 0) return decrypted
    const first = decrypted[0]
    if (first !== '{' && first !== '[') return decrypted
    try { return JSON.parse(decrypted) } catch { return decrypted }
  },
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
    getDek.mockImplementation(defaultGetDek)
    encryptEntityPayload.mockImplementation(defaultEncryptEntityPayload)
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    cli = require('@open-mercato/core/modules/entities/cli').default
  })

  const singleMapFixture = () => {
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
      if (entity === Organization) return [{ id: 'org-1', tenantId: 'tenant-1' }]
      return []
    })
  }

  it('rotates mapped fields with old key and updates rows', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    const encryptedValue = 'iv:cipher:tag:v1'

    singleMapFixture()

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

  // Regression for #5951: a row sealed under neither --old-key nor the current tenant key
  // used to be handed to the encrypt path verbatim, which wrapped the ciphertext in a second
  // envelope and wrote the result. Skip and report the row instead of corrupting it.
  it('skips a row whose ciphertext opens under neither the old nor the current key', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    singleMapFixture()
    execute.mockResolvedValueOnce([
      { id: 'row-1', resource_id: 'iv:cipher:tag:v1', context_json: null },
    ])
    // Neither key opens it.
    ;(decryptWithAesGcm as jest.Mock).mockReturnValue(null)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await rotate.run(['--old-key', 'old-secret', '--tenant', 'tenant-1', '--org', 'org-1'])

    // The unopenable field must not reach the encrypt path at all.
    expect(encryptEntityPayload.mock.calls[0][1]).not.toHaveProperty('resource_id')
    // Only the select ran — no UPDATE re-wrapped the ciphertext.
    expect(execute).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('opens under neither --old-key nor the current tenant key'))

    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('keeps an already-rotated row in the payload so the service skips it', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    singleMapFixture()
    execute.mockResolvedValueOnce([
      { id: 'row-1', resource_id: 'iv:cipher:tag:v1', context_json: null },
    ])
    // The old key fails, the current key succeeds: this row was rotated by an earlier,
    // interrupted run. It must be left alone rather than reported as unrecoverable.
    ;(decryptWithAesGcm as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('already-rotated')
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await rotate.run(['--old-key', 'old-secret', '--tenant', 'tenant-1', '--org', 'org-1'])

    expect(encryptEntityPayload.mock.calls[0][1]).toHaveProperty('resource_id', 'iv:cipher:tag:v1')
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('opens under neither'))

    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  // Regression for #5950: encryptEntityPayload provisions a tenant DEK in KMS/Vault
  // the first time it runs for a tenant, so a dry run against a tenant that has none
  // used to create real key material as a side effect.
  it('provisions no DEK on --dry-run when the tenant has none, and still reports the pending rows', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    singleMapFixture()
    getDek.mockResolvedValue(null)
    execute.mockResolvedValueOnce([
      { id: 'row-1', resource_id: 'plain-value', context_json: null },
    ])
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1', '--dry-run'])

    expect(encryptEntityPayload).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1) // the select only — no update was issued
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no key material was provisioned'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Encrypted 1 record(s)'))

    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('asks the encryption service not to create a missing DEK while dry-running', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    singleMapFixture()
    execute.mockResolvedValueOnce([
      { id: 'row-1', resource_id: 'plain-value', context_json: null },
    ])
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1', '--dry-run'])

    expect(encryptEntityPayload).toHaveBeenCalledWith(
      'audit_logs:access_log',
      expect.anything(),
      'tenant-1',
      'org-1',
      { createMissingDek: false },
    )
    expect(execute).toHaveBeenCalledTimes(1) // still no update on a dry run

    logSpy.mockRestore()
  })

  it('allows DEK provisioning on a real run', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    singleMapFixture()
    execute.mockResolvedValueOnce([
      { id: 'row-1', resource_id: 'plain-value', context_json: null },
    ])
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1'])

    expect(encryptEntityPayload).toHaveBeenCalledWith(
      'audit_logs:access_log',
      expect.anything(),
      'tenant-1',
      'org-1',
      { createMissingDek: true },
    )
    expect(execute).toHaveBeenCalledTimes(2) // select + update

    logSpy.mockRestore()
  })
})
