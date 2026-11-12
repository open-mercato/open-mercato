import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { EncryptionMap } from '../data/entities'
import { encryptWithAesGcm, isEncryptedPayloadShape, TenantDataEncryptionErrorCode } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const databaseUrl = process.env.OM_ENCRYPTION_MAINTENANCE_TEST_DATABASE_URL
const describePostgres = process.env.OM_PG_INTEGRATION === '1' && databaseUrl ? describe : describe.skip
const mockKey = Buffer.alloc(32, 27).toString('base64')
let mockManager: unknown

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => mockManager }),
}))
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: () => ({
    isHealthy: () => true,
    getTenantDek: async (tenantId: string) => ({ tenantId, key: mockKey, fetchedAt: 0 }),
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => true,
  isEncryptionDebugEnabled: () => false,
}))
jest.mock('../lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: jest.fn(),
  getAggregatedCustomEntityConfigs: () => [],
}))

registerEntityIds({ audit_logs: { access_log: 'audit_logs:access_log' } })

describePostgres('offline encryption maintenance in PostgreSQL', () => {
  let admin: Pool
  let pool: Pool
  let schema: string
  let beforeTransaction: (() => Promise<void>) | undefined
  let afterRowRead: (() => Promise<void>) | undefined
  const tenantId = 'maintenance-tenant'

  beforeEach(async () => {
    schema = `maintenance_${randomUUID().replaceAll('-', '')}`
    admin = new Pool({ connectionString: databaseUrl })
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` })
    await pool.query(`CREATE TABLE encryption_maps (id text PRIMARY KEY, entity_id text, tenant_id text, organization_id text, fields_json jsonb, is_active boolean, deleted_at timestamptz)`)
    await pool.query(`CREATE TABLE access_logs (id text PRIMARY KEY, tenant_id text, organization_id text, resource_id text, resource_hash text)`)
    await pool.query(`INSERT INTO encryption_maps VALUES ('global-map', 'audit_logs:access_log', $1, NULL, '[{"field":"resource_id"}]', true, NULL)`, [tenantId])
    beforeTransaction = undefined
    afterRowRead = undefined
    const metadata = {
      className: 'AccessLog', name: 'AccessLog', tableName: 'access_logs', schema, primaryKeys: ['id'],
      properties: {
        id: { name: 'id', fieldNames: ['id'], type: 'text', columnTypes: ['text'] },
        resourceId: { name: 'resourceId', fieldNames: ['resource_id'], type: 'text', columnTypes: ['text'] },
        resourceHash: { name: 'resourceHash', fieldNames: ['resource_hash'], type: 'text', columnTypes: ['text'] },
      },
    }
    const buildManager = (connection: Pool | PoolClient) => {
      const execute = async (statement: string, parameters: unknown[] = []) => {
        let index = 0
        const result = await connection.query(statement.replace(/\?/g, () => `$${++index}`), parameters)
        if (afterRowRead && result.rows.length > 0 && statement.startsWith('SELECT') && statement.includes('ORDER BY')) {
          const callback = afterRowRead
          afterRowRead = undefined
          await callback()
        }
        return result.rows
      }
      return {
        getConnection: () => ({ execute }),
        getTransactionContext: () => undefined,
        getMetadata: () => ({ getAll: () => [metadata] }),
        find: async (entity: unknown, where: Record<string, unknown>) => {
          if (entity !== EncryptionMap) return []
          const result = await connection.query(`SELECT * FROM encryption_maps WHERE tenant_id = $1 AND is_active = true AND deleted_at IS NULL`, [tenantId])
          return result.rows.filter((row) => !where.$or || row.organization_id === null || row.organization_id === 'org-a').map((row) => Object.assign(new EncryptionMap(), {
            id: row.id, entityId: row.entity_id, tenantId: row.tenant_id,
            organizationId: row.organization_id, fieldsJson: row.fields_json, isActive: row.is_active, deletedAt: row.deleted_at,
          }))
        },
        transactional: async (callback: (manager: unknown) => Promise<void>) => {
          if (beforeTransaction) await beforeTransaction()
          const client = await pool.connect()
          try {
            await client.query('BEGIN')
            await callback(buildManager(client))
            await client.query('COMMIT')
          } catch (error) {
            await client.query('ROLLBACK')
            throw error
          } finally {
            client.release()
          }
        },
      }
    }
    mockManager = buildManager(pool)
  })

  afterEach(async () => {
    if (pool) await pool.end()
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  const run = async (extra: string[] = []) => {
    const commands = (await import('../cli')).default
    const command = commands.find((candidate) => candidate.command === 'decrypt-database')!
    await command.run(['--tenant', tenantId, '--confirm', tenantId, '--confirm-offline-maintenance', tenantId, ...extra])
  }
  const insert = async (id: string, organizationId: string | null) => {
    const ciphertext = encryptWithAesGcm(`secret-${id}`, mockKey).value
    await pool.query(`INSERT INTO access_logs (id, tenant_id, organization_id, resource_id) VALUES ($1, $2, $3, $4)`, [id, tenantId, organizationId, ciphertext])
    return ciphertext
  }

  test.each([{ flags: [] }, { flags: ['--check'] }, { flags: ['--dry-run'] }, { flags: ['--deactivate-maps'] }])('rejects wrong-DEK ciphertext with flags %j without changing rows or policies', async ({ flags }) => {
    const ciphertext = encryptWithAesGcm('wrong-key-secret', Buffer.alloc(32, 61).toString('base64')).value
    await pool.query(`INSERT INTO access_logs VALUES ('wrong-key', $1, 'org-a', $2, 'original-hash')`, [tenantId, ciphertext])
    const logSpy = jest.spyOn(console, 'log').mockImplementation()
    try {
      await expect(run(flags)).rejects.toMatchObject({ code: TenantDataEncryptionErrorCode.AUTH_FAILED })
      expect((await pool.query(`SELECT resource_id, resource_hash FROM access_logs`)).rows).toEqual([
        { resource_id: ciphertext, resource_hash: 'original-hash' },
      ])
      expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
      expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Decryption complete')
    } finally {
      logSpy.mockRestore()
    }
  })

  test('authentication failure rolls back earlier row updates in the same batch and leaves policies active', async () => {
    const original = await insert('a-valid', 'org-a')
    const ciphertext = encryptWithAesGcm('wrong-key-secret', Buffer.alloc(32, 61).toString('base64')).value
    await pool.query(`INSERT INTO access_logs VALUES ('z-wrong', $1, 'org-a', $2, NULL)`, [tenantId, ciphertext])
    await expect(run(['--deactivate-maps'])).rejects.toMatchObject({ code: TenantDataEncryptionErrorCode.AUTH_FAILED })
    expect((await pool.query(`SELECT resource_id FROM access_logs WHERE id = 'a-valid'`)).rows[0].resource_id).toBe(original)
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
  })

  test('a changed policy prevents retirement after row decryption', async () => {
    await insert('one', 'org-a')
    beforeTransaction = async () => {
      await pool.query(`UPDATE encryption_maps SET fields_json = '[]'::jsonb`)
    }
    await expect(run(['--deactivate-maps'])).rejects.toThrow('policies changed')
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
  })

  test('plaintext remains unchanged across normal and check reruns', async () => {
    await pool.query(`INSERT INTO access_logs VALUES ('plain', $1, 'org-a', 'already-plain', 'original-hash')`, [tenantId])
    await run()
    await run(['--check'])
    await run()
    expect((await pool.query(`SELECT resource_id, resource_hash FROM access_logs`)).rows).toEqual([
      { resource_id: 'already-plain', resource_hash: 'original-hash' },
    ])
  })

  test('dry-run preserves ciphertext and active policies', async () => {
    const ciphertext = await insert('one', 'org-a')
    await run(['--dry-run', '--deactivate-maps'])
    expect((await pool.query(`SELECT resource_id FROM access_logs`)).rows[0].resource_id).toBe(ciphertext)
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
  })

  test.each([
    ['--tenant', tenantId, '--confirm', 'wrong-tenant'],
    ['--tenant', tenantId, '--confirm', tenantId, '--deactivate-maps'],
    ['--tenant', tenantId, '--confirm', tenantId, '--deactivate-maps', '--confirm-offline-maintenance', 'wrong-tenant'],
  ])('rejects unsafe confirmation arguments %j before writes', async (...flags) => {
    const ciphertext = await insert('one', 'org-a')
    const commands = (await import('../cli')).default
    await expect(commands.find((candidate) => candidate.command === 'decrypt-database')!.run(flags)).rejects.toThrow()
    expect((await pool.query(`SELECT resource_id FROM access_logs`)).rows[0].resource_id).toBe(ciphertext)
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
  })

  test('decrypts actual organization and global rows before retiring their tenant-wide fallback', async () => {
    await insert('one', 'org-a')
    await insert('two', 'org-b')
    await insert('global', null)
    await run(['--deactivate-maps'])
    const rows = await pool.query(`SELECT id, resource_id FROM access_logs ORDER BY id`)
    expect(rows.rows).toEqual([
      { id: 'global', resource_id: 'secret-global' },
      { id: 'one', resource_id: 'secret-one' },
      { id: 'two', resource_id: 'secret-two' },
    ])
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(false)
  })

  test('organization-only work preserves the fallback and other organizations ciphertext', async () => {
    await insert('one', 'org-a')
    const otherCiphertext = await insert('two', 'org-b')
    await run(['--org', 'org-a', '--deactivate-maps'])
    const rows = await pool.query(`SELECT id, resource_id FROM access_logs ORDER BY id`)
    expect(rows.rows).toEqual([{ id: 'one', resource_id: 'secret-one' }, { id: 'two', resource_id: otherCiphertext }])
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
  })

  test('CAS preserves a concurrent writer value instead of replacing it with stale plaintext', async () => {
    await insert('one', 'org-a')
    const replacement = encryptWithAesGcm('concurrent-write', mockKey).value
    afterRowRead = async () => { await pool.query(`UPDATE access_logs SET resource_id = $1 WHERE id = 'one'`, [replacement]) }
    await expect(run()).rejects.toThrow('changed concurrently')
    expect((await pool.query(`SELECT resource_id FROM access_logs`)).rows[0].resource_id).toBe(replacement)
  })

  test('residual ciphertext at the protected final sweep rolls back policy retirement', async () => {
    await insert('one', 'org-a')
    beforeTransaction = async () => {
      await pool.query(`UPDATE access_logs SET resource_id = $1 WHERE id = 'one'`, [encryptWithAesGcm('late-write', mockKey).value])
    }
    await expect(run(['--deactivate-maps'])).rejects.toThrow('protected final sweep')
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
    expect(isEncryptedPayloadShape((await pool.query(`SELECT resource_id FROM access_logs`)).rows[0].resource_id)).toBe(true)
  })
  test('CAS refuses to write a row moved outside the selected tenant and organization', async () => {
    const original = await insert('one', 'org-a')
    afterRowRead = async () => { await pool.query(`UPDATE access_logs SET tenant_id = 'other-tenant', organization_id = 'other-org' WHERE id = 'one'`) }
    await expect(run()).rejects.toThrow('changed concurrently')
    expect((await pool.query(`SELECT tenant_id, organization_id, resource_id FROM access_logs`)).rows).toEqual([
      { tenant_id: 'other-tenant', organization_id: 'other-org', resource_id: original },
    ])
  })

  test('includes organization-map fields in the null-organization aggregate policy', async () => {
    await pool.query(`INSERT INTO encryption_maps VALUES ('org-map', 'audit_logs:access_log', $1, 'org-a', '[{"field":"resource_id"}]', true, NULL)`, [tenantId])
    await pool.query(`DELETE FROM encryption_maps WHERE id = 'global-map'`)
    await insert('global', null)
    await insert('one', 'org-a')
    await run(['--deactivate-maps'])
    expect((await pool.query(`SELECT id, resource_id FROM access_logs ORDER BY id`)).rows).toEqual([
      { id: 'global', resource_id: 'secret-global' }, { id: 'one', resource_id: 'secret-one' },
    ])
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(false)
  })

  test('selects a real non-null lookup hash before comparing and clearing it during decryption', async () => {
    await pool.query(`UPDATE encryption_maps SET fields_json = '[{"field":"resource_id","hashField":"resource_hash"}]'::jsonb`)
    await insert('one', 'org-a')
    await pool.query(`UPDATE access_logs SET resource_hash = 'existing-non-null-hash' WHERE id = 'one'`)
    await run()
    expect((await pool.query(`SELECT resource_id, resource_hash FROM access_logs`)).rows).toEqual([
      { resource_id: 'secret-one', resource_hash: null },
    ])
  })

  test('checks every bounded final-sweep page before retiring policies', async () => {
    await insert('one', 'org-a')
    await insert('two', 'org-a')
    beforeTransaction = async () => {
      await pool.query(`UPDATE access_logs SET resource_id = $1 WHERE id = 'two'`, [encryptWithAesGcm('late-second-page', mockKey).value])
    }
    await expect(run(['--deactivate-maps', '--batch-size', '1'])).rejects.toThrow('protected final sweep')
    expect((await pool.query(`SELECT is_active FROM encryption_maps`)).rows[0].is_active).toBe(true)
    expect((await pool.query(`SELECT resource_id FROM access_logs WHERE id = 'one'`)).rows[0].resource_id).toBe('secret-one')
    expect(isEncryptedPayloadShape((await pool.query(`SELECT resource_id FROM access_logs WHERE id = 'two'`)).rows[0].resource_id)).toBe(true)
  })

})
