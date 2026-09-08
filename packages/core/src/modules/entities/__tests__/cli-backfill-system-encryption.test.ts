/** @jest-environment node */
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

registerEntityIds({
  onboarding: {
    onboarding_request: 'onboarding:onboarding_request',
  },
} as any)

const execute = jest.fn()
const isEnabled = jest.fn(() => true)
const encryptEntityPayload = jest.fn()
const systemMaps = [
  {
    entityId: 'onboarding:onboarding_request',
    keyScope: 'system',
    fields: [
      { field: 'email', hashField: 'email_hash' },
      { field: 'first_name', hashField: null },
    ],
  },
]

jest.mock('@open-mercato/core/modules/entities/lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: jest.fn(async () => ({ processed: 0, synchronized: 0, fieldChanges: 0, skipped: 0 })),
  getAggregatedCustomEntityConfigs: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/modules/registry', () => ({
  getCliModules: () => [{ id: 'onboarding' }],
  getDefaultEncryptionMaps: () => systemMaps,
}))

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => isEnabled(),
    getDek: jest.fn(async () => ({ tenantId: 'system:onboarding:onboarding_request', key: 'system-key', fetchedAt: 0 })),
    encryptEntityPayload: (...args: unknown[]) => encryptEntityPayload(...args),
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
            emailHash: { name: 'emailHash', fieldNames: ['email_hash'], columnTypes: ['text'], type: 'text' },
            firstName: { name: 'firstName', fieldNames: ['first_name'], columnTypes: ['text'], type: 'text' },
          },
        }]),
      }),
      find: jest.fn(async () => []),
    }),
  }),
}))

const ciphertext = (value: string) => `iv:${value}:tag:v1`

function queueSelects(...batches: Array<Array<Record<string, unknown>>>) {
  let index = 0
  execute.mockImplementation(async (sql: string) => {
    if (String(sql).startsWith('update')) return []
    const batch = batches[index] ?? []
    index += 1
    return batch
  })
}

function loadCommand() {
  const cli = require('@open-mercato/core/modules/entities/cli').default as Array<{ command: string; run: (args: string[]) => Promise<void> }>
  return cli.find((entry) => entry.command === 'backfill-system-encryption')!
}

describe('entities backfill-system-encryption CLI', () => {
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    isEnabled.mockReturnValue(true)
    encryptEntityPayload.mockImplementation(async (_entityId: string, payload: Record<string, unknown>) => {
      const next: Record<string, unknown> = { ...payload }
      for (const rule of systemMaps[0]!.fields) {
        const value = payload[rule.field]
        if (typeof value !== 'string' || value.endsWith(':v1')) continue
        next[rule.field] = ciphertext(value)
        if (rule.hashField) next[rule.hashField] = `hash(${value})`
      }
      return next
    })
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('encrypts plaintext rows and backfills the lookup hash column', async () => {
    queueSelects([{ id: 'row-1', email: 'ada@example.com', email_hash: null, first_name: 'Ada' }])

    await loadCommand().run([])

    const updateCalls = execute.mock.calls.filter(([sql]) => String(sql).startsWith('update'))
    expect(updateCalls).toHaveLength(1)
    const [updateSql, updateParams] = updateCalls[0]!
    expect(updateSql).toContain('"onboarding_requests"')
    expect(updateSql).toContain('"email" = ?')
    expect(updateSql).toContain('"email_hash" = ?')
    expect(updateSql).toContain('"first_name" = ?')
    expect(updateParams).toEqual([
      ciphertext('ada@example.com'),
      'hash(ada@example.com)',
      ciphertext('Ada'),
      'row-1',
    ])
  })

  it('skips rows that are already encrypted', async () => {
    queueSelects([{ id: 'row-1', email: ciphertext('ada@example.com'), email_hash: 'hash(ada@example.com)', first_name: ciphertext('Ada') }])

    await loadCommand().run([])

    expect(encryptEntityPayload).not.toHaveBeenCalled()
    expect(execute.mock.calls.filter(([sql]) => String(sql).startsWith('update'))).toHaveLength(0)
  })

  it('writes nothing in dry-run mode but still reports the rows it would encrypt', async () => {
    queueSelects([{ id: 'row-1', email: 'ada@example.com', email_hash: null, first_name: 'Ada' }])

    await loadCommand().run(['--dry-run'])

    expect(execute.mock.calls.filter(([sql]) => String(sql).startsWith('update'))).toHaveLength(0)
    expect(logSpy.mock.calls.flat().join('\n')).toContain('[dry-run] onboarding:onboarding_request: scanned 1, encrypted 1')
  })

  it('pages through rows with a keyset cursor', async () => {
    queueSelects(
      [{ id: 'row-1', email: 'a@example.com', email_hash: null, first_name: 'A' }],
      [{ id: 'row-2', email: 'b@example.com', email_hash: null, first_name: 'B' }],
    )

    await loadCommand().run(['--batch-size', '1'])

    const selectCalls = execute.mock.calls.filter(([sql]) => String(sql).startsWith('select'))
    expect(selectCalls).toHaveLength(3)
    expect(selectCalls[0]![0]).not.toContain('where')
    expect(selectCalls[1]![0]).toContain('where "id" > ?')
    expect(selectCalls[1]![1]).toEqual(['row-1', 1])
    expect(selectCalls[2]![1]).toEqual(['row-2', 1])
  })

  it('warns instead of silently succeeding when the system DEK is unavailable', async () => {
    encryptEntityPayload.mockImplementation(async (_entityId: string, payload: Record<string, unknown>) => payload)
    queueSelects([{ id: 'row-1', email: 'ada@example.com', email_hash: null, first_name: 'Ada' }])

    await loadCommand().run([])

    expect(execute.mock.calls.filter(([sql]) => String(sql).startsWith('update'))).toHaveLength(0)
    expect(warnSpy.mock.calls.flat().join('\n')).toContain('the system DEK was unavailable')
  })

  it('aborts without touching the database when encryption is disabled', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'false'

    await loadCommand().run([])

    expect(execute).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('TENANT_DATA_ENCRYPTION is disabled')
  })

  it('aborts without touching the database when the KMS is unhealthy', async () => {
    isEnabled.mockReturnValue(false)

    await loadCommand().run([])

    expect(execute).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Encryption service is not enabled')
  })

  it('rejects an unknown --entity instead of backfilling everything', async () => {
    await loadCommand().run(['--entity', 'onboarding:unknown'])

    expect(execute).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('No system-scoped encryption map declared for entity "onboarding:unknown"')
  })
})
