/** @jest-environment node */
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import {
  TenantDataEncryptionError,
  TenantDataEncryptionErrorCode,
  decryptWithAesGcmStrict,
} from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

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

jest.mock('@open-mercato/shared/lib/encryption/aes', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/encryption/aes')
  return {
    ...actual,
    decryptWithAesGcmStrict: jest.fn(),
  }
})

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: jest.fn(() => ({
    isHealthy: () => true,
    getTenantDek: jest.fn(async (tenantId: string) => ({ tenantId, key: 'test-dek-base64', fetchedAt: Date.now() })),
    createTenantDek: jest.fn(async (tenantId: string) => ({ tenantId, key: 'test-dek-base64', fetchedAt: Date.now() })),
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: jest.fn(() => true),
  isEncryptionDebugEnabled: jest.fn(() => false),
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
            id: {
              name: 'id',
              fieldNames: ['id'],
              columnTypes: ['uuid'],
              type: 'uuid',
            },
            resourceId: {
              name: 'resourceId',
              fieldNames: ['resource_id'],
              columnTypes: ['text'],
              type: 'text',
            },
            emailHash: {
              name: 'emailHash',
              fieldNames: ['email_hash'],
              columnTypes: ['text'],
              type: 'text',
            },
          },
        }]),
      }),
      find: (...args: any[]) => find(...args),
    }),
  }),
}))

describe('entities decrypt-database CLI', () => {
  let cli: Array<{ command: string; run: (args: string[]) => Promise<void> }>
  const mockDecrypt = decryptWithAesGcmStrict as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    execute.mockResolvedValue([])
    // Reset isTenantDataEncryptionEnabled to true so tests that mock it false don't pollute subsequent tests
    const togglesMock = require('@open-mercato/shared/lib/encryption/toggles')
    togglesMock.isTenantDataEncryptionEnabled.mockReturnValue(true)
    cli = require('@open-mercato/core/modules/entities/cli').default
  })

  const getCmd = () => cli.find((c: any) => c.command === 'decrypt-database')!

  function makeMap(overrides: any = {}): any {
    return {
      entityId: 'audit_logs:access_log',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fieldsJson: [{ field: 'resource_id', hashField: 'email_hash' }],
      deletedAt: null,
      isActive: true,
      ...overrides,
    }
  }

  function setupDefaultMapFind(maps: any[] = [makeMap()]) {
    find.mockImplementation(async (entity: any) => {
      if (entity === EncryptionMap) return maps
      return []
    })
  }

  function setupScopesAndRows(rows: any[]) {
    execute.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return undefined
      if (sql.includes('DISTINCT organization_id')) return [{ organization_id: 'org-1' }]
      if (sql.includes('SELECT') && sql.includes('access_logs')) {
        const isKeysetQuery = sql.includes('"id" >')
        if (isKeysetQuery) return []
        return rows
      }
      return []
    })
  }

  it('aborts when --tenant is missing', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    await getCmd().run(['--confirm', 'tenant-1'])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--tenant'))
    expect(find).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('aborts when --confirm is missing', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1'])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--confirm'))
    expect(find).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('aborts when --confirm does not match --tenant', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'wrong-tenant'])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('does not match'))
    expect(find).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('aborts when TENANT_DATA_ENCRYPTION is disabled', async () => {
    const { isTenantDataEncryptionEnabled } = require('@open-mercato/shared/lib/encryption/toggles')
    isTenantDataEncryptionEnabled.mockReturnValue(false)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'))
    consoleSpy.mockRestore()
  })

  it('--check mode: prints env value, map count, and sampling estimate without writes', async () => {
    setupDefaultMapFind()
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('DISTINCT organization_id')) return [{ organization_id: 'org-1' }]
      if (sql.includes('SELECT') && sql.includes('access_logs')) {
        return [{ id: 'row-1', resource_id: 'iv:cipher:tag:v1' }]
      }
      return []
    })
    mockDecrypt.mockImplementationOnce(() => 'decrypted-value')

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--check'])
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('TENANT_DATA_ENCRYPTION')
    expect(output).toContain('Active EncryptionMap records')
    expect(output).toContain('estimated encrypted candidates')
    expect(output).toContain('not a proof of absence')
    expect(execute).not.toHaveBeenCalledWith('BEGIN')
    expect(execute).not.toHaveBeenCalledWith('COMMIT')
    consoleSpy.mockRestore()
  })

  it('--check mode: reports malformed payloads with warning when count > 0', async () => {
    setupDefaultMapFind()
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('DISTINCT organization_id')) return [{ organization_id: 'org-1' }]
      if (sql.includes('SELECT') && sql.includes('access_logs')) {
        return [{ id: 'row-1', resource_id: 'bad:malformed:payload:v1' }]
      }
      return []
    })
    mockDecrypt.mockImplementationOnce(() => {
      throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.MALFORMED_PAYLOAD, 'bad payload')
    })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--check'])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed payloads (sampled): 1'))
    warnSpy.mockRestore()
  })

  it('--dry-run: scans rows but does not execute UPDATE', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([{ id: 'row-1', resource_id: 'iv:cipher:tag:v1', email_hash: 'old-hash' }])
    mockDecrypt.mockReturnValueOnce('decrypted@example.com')

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1', '--dry-run'])

    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(0)
    expect(execute).toHaveBeenCalledWith('BEGIN')
    expect(execute).toHaveBeenCalledWith('COMMIT')
  })

  it('decrypts fields and writes plaintext back to DB', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([{ id: 'row-1', resource_id: 'iv:cipher:tag:v1', email_hash: 'old-hash' }])
    mockDecrypt.mockReturnValueOnce('decrypted@example.com')

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(1)
    const [sql, params] = updateCalls[0]
    expect(sql).toMatch(/UPDATE\s+"access_logs"/)
    expect(params).toContain('decrypted@example.com')
    expect(params).toContain(null) // hash field nulled
    expect(params).toContain('row-1')
  })

  it('clears hash fields only when rowDecrypted is true', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([
      { id: 'row-1', resource_id: 'iv:cipher:tag:v1', email_hash: 'hash-1' },
      { id: 'row-2', resource_id: 'already-plain', email_hash: 'hash-2' },
    ])
    mockDecrypt
      .mockReturnValueOnce('decrypted-value') // row-1 decrypted
      .mockImplementationOnce(() => {
        throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.AUTH_FAILED, 'plaintext')
      }) // row-2 is plaintext

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(1)
    const [, params] = updateCalls[0]
    expect(params).toContain('row-1')
    expect(params).toContain(null) // hash nulled for row-1
    expect(params).not.toContain('row-2')
  })

  it('skips NULL field values silently without warning or update', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([{ id: 'row-1', resource_id: null, email_hash: null }])

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    expect(mockDecrypt).not.toHaveBeenCalled()
    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(0)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('null'))
    warnSpy.mockRestore()
  })

  it('idempotency: AUTH_FAILED on all fields produces zero updates', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([{ id: 'row-1', resource_id: 'already-plain', email_hash: null }])
    mockDecrypt.mockImplementation(() => {
      throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.AUTH_FAILED, 'plaintext')
    })

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(0)
  })

  it('MALFORMED_PAYLOAD: warns, increments counter, skips field without aborting run', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([{ id: 'row-1', resource_id: 'bad:b64:!!:v1', email_hash: null }])
    mockDecrypt.mockImplementationOnce(() => {
      throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.MALFORMED_PAYLOAD, 'bad base64')
    })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const logSpy = jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MALFORMED_PAYLOAD'))
    const summaryText = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(summaryText).toContain('1 field value(s) returned MALFORMED_PAYLOAD')
    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(0)
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('KMS_UNAVAILABLE: rolls back current batch and rejects', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([{ id: 'row-1', resource_id: 'iv:cipher:tag:v1', email_hash: null }])
    mockDecrypt.mockImplementationOnce(() => {
      throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.KMS_UNAVAILABLE, 'KMS down')
    })

    jest.spyOn(console, 'error').mockImplementation()
    await expect(
      getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1']),
    ).rejects.toThrow()

    expect(execute).toHaveBeenCalledWith('ROLLBACK')
    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(0)
  })

  it('non-TenantDataEncryptionError: rolls back and rejects', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([{ id: 'row-1', resource_id: 'iv:cipher:tag:v1', email_hash: null }])
    mockDecrypt.mockImplementationOnce(() => { throw new Error('Unexpected raw error') })

    jest.spyOn(console, 'error').mockImplementation()
    await expect(
      getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1']),
    ).rejects.toThrow('Unexpected raw error')

    expect(execute).toHaveBeenCalledWith('ROLLBACK')
  })

  it('missing hashField column: warns and skips, lists in summary', async () => {
    setupDefaultMapFind([makeMap({ fieldsJson: [{ field: 'resource_id', hashField: 'nonexistent_hash' }] })])
    setupScopesAndRows([{ id: 'row-1', resource_id: 'iv:cipher:tag:v1' }])
    mockDecrypt.mockReturnValueOnce('decrypted-value')

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const logSpy = jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent_hash'))
    const logText = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logText).toMatch(/skipped.*missing columns/)
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('--deactivate-maps: deactivates maps after decryption', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([])

    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'warn').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1', '--deactivate-maps'])

    const deactivateCalls = execute.mock.calls.filter((c) =>
      String(c[0]).includes('UPDATE encryption_maps') && String(c[0]).includes('is_active = false'),
    )
    expect(deactivateCalls).toHaveLength(1)
    expect(deactivateCalls[0][1]).toContain('tenant-1')
  })

  it('--deactivate-maps with --org: deactivates org maps AND global maps', async () => {
    setupDefaultMapFind([makeMap({ organizationId: 'org-1' })])
    execute.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return undefined
      if (sql.includes('SELECT') && sql.includes('access_logs')) return []
      return []
    })

    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'warn').mockImplementation()
    await getCmd().run([
      '--tenant', 'tenant-1',
      '--confirm', 'tenant-1',
      '--org', 'org-1',
      '--deactivate-maps',
    ])

    const deactivateCalls = execute.mock.calls.filter((c) =>
      String(c[0]).includes('UPDATE encryption_maps') && String(c[0]).includes('is_active = false'),
    )
    expect(deactivateCalls).toHaveLength(1)
    const [deactivateSql] = deactivateCalls[0]
    expect(deactivateSql).toMatch(/organization_id\s*=\s*\?/)
    expect(deactivateSql).toMatch(/organization_id\s+IS\s+NULL/)
  })

  it('--deactivate-maps with --dry-run: does not execute deactivation SQL', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([])

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1', '--deactivate-maps', '--dry-run'])

    const deactivateCalls = execute.mock.calls.filter((c) =>
      String(c[0]).includes('UPDATE encryption_maps'),
    )
    expect(deactivateCalls).toHaveLength(0)
  })

  it('--batch-size: keyset pagination processes all rows across multiple batches', async () => {
    setupDefaultMapFind()
    let selectCallCount = 0
    execute.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return undefined
      if (sql.includes('DISTINCT organization_id')) return [{ organization_id: 'org-1' }]
      if (sql.includes('SELECT') && sql.includes('access_logs')) {
        selectCallCount++
        if (selectCallCount === 1) {
          return [
            { id: 'row-1', resource_id: 'iv:cipher:tag:v1', email_hash: null },
            { id: 'row-2', resource_id: 'iv:cipher:tag:v1', email_hash: null },
          ]
        }
        if (selectCallCount === 2) {
          return [{ id: 'row-3', resource_id: 'iv:cipher:tag:v1', email_hash: null }]
        }
        return []
      }
      return []
    })
    mockDecrypt.mockReturnValue('decrypted-value')

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1', '--batch-size', '2'])

    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(3)
    // Second SELECT should include keyset id > condition
    const keysetCalls = execute.mock.calls.filter((c) =>
      String(c[0]).includes('SELECT') && String(c[0]).includes('"id" >'),
    )
    expect(keysetCalls.length).toBeGreaterThan(0)
  })

  it('--entity filter: passes entityId to EncryptionMap find', async () => {
    find.mockImplementation(async (entity: any, where: any) => {
      if (entity === EncryptionMap && where.entityId === 'audit_logs:access_log') return [makeMap()]
      return []
    })
    setupScopesAndRows([])

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run([
      '--tenant', 'tenant-1',
      '--confirm', 'tenant-1',
      '--entity', 'audit_logs:access_log',
    ])

    const findCalls = find.mock.calls.filter((c) => c[0] === EncryptionMap)
    expect(findCalls.length).toBeGreaterThan(0)
    expect(findCalls[0][1]).toMatchObject({ entityId: 'audit_logs:access_log' })
  })

  it('--org filter: passes organizationId to EncryptionMap find and skips DISTINCT query', async () => {
    find.mockImplementation(async (entity: any, where: any) => {
      if (entity === EncryptionMap && where.organizationId === 'org-1') return [makeMap()]
      return []
    })
    execute.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return undefined
      if (sql.includes('SELECT') && sql.includes('access_logs')) return []
      return []
    })

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run([
      '--tenant', 'tenant-1',
      '--confirm', 'tenant-1',
      '--org', 'org-1',
    ])

    const findCalls = find.mock.calls.filter((c) => c[0] === EncryptionMap)
    expect(findCalls[0][1]).toMatchObject({ organizationId: 'org-1' })
    // No DISTINCT query since org is explicit
    const distinctCalls = execute.mock.calls.filter((c) => String(c[0]).includes('DISTINCT organization_id'))
    expect(distinctCalls).toHaveLength(0)
  })

  it('prints post-step instructions with idempotency note on success', async () => {
    setupDefaultMapFind()
    setupScopesAndRows([])

    const logSpy = jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('TENANT_DATA_ENCRYPTION=false')
    expect(output).toContain('query_index reindex')
    expect(output).toContain('idempotent')
    logSpy.mockRestore()
  })

  it('JSON.parse non-string result: writes raw decrypted string', async () => {
    setupDefaultMapFind([makeMap({ fieldsJson: [{ field: 'resource_id' }] })])
    setupScopesAndRows([{ id: 'row-1', resource_id: 'iv:cipher:tag:v1' }])
    // Returns a JSON-encoded object string
    mockDecrypt.mockReturnValueOnce('{"key":"value","num":42}')

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    const updateCalls = execute.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE'))
    expect(updateCalls).toHaveLength(1)
    // Raw JSON string should be written (not the parsed object)
    expect(updateCalls[0][1]).toContain('{"key":"value","num":42}')
  })

  it('processes global (null org) records by including null scope', async () => {
    setupDefaultMapFind([makeMap({ organizationId: null })])
    execute.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return undefined
      if (sql.includes('DISTINCT organization_id')) return [{ organization_id: null }]
      if (sql.includes('SELECT') && sql.includes('access_logs')) return []
      return []
    })

    jest.spyOn(console, 'log').mockImplementation()
    await getCmd().run(['--tenant', 'tenant-1', '--confirm', 'tenant-1'])

    const selectCalls = execute.mock.calls.filter((c) =>
      String(c[0]).includes('SELECT') && String(c[0]).includes('access_logs'),
    )
    // Should have been called with null as the org scope parameter
    expect(selectCalls.some((c) => Array.isArray(c[1]) && c[1][1] === null)).toBe(true)
  })
})
