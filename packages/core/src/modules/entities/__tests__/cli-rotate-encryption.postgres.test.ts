import { createHash, pbkdf2Sync, randomUUID } from 'node:crypto'
import { PostgreSqlPlatform } from '@mikro-orm/postgresql'
import { Pool, type PoolClient } from 'pg'
import { decryptWithAesGcm, encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { EncryptionMap } from '../data/entities'

const databaseUrl = process.env.OM_ENCRYPTION_MAINTENANCE_TEST_DATABASE_URL
const describePostgres = process.env.OM_PG_INTEGRATION === '1' && databaseUrl ? describe : describe.skip
const tenantId = 'rotation-test-tenant'
const organizationId = 'rotation-test-org'
const oldRoot = 'rotation-test-old-root'
const mockKey = Buffer.alloc(32, 23).toString('base64')
let mockManager: unknown

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (name: string) => name === 'em' ? mockManager : undefined }),
}))
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: () => ({
    isHealthy: () => true,
    getTenantDek: async () => ({ tenantId, key: mockKey, fetchedAt: 0 }),
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

describePostgres('encryption maintenance compares original PostgreSQL JSON values', () => {
  const schema = 'rotation_' + randomUUID().replaceAll('-', '')
  const table = '"' + schema + '"."access_logs"'
  const platform = new PostgreSqlPlatform()
  const scope = ['--tenant', tenantId, '--org', organizationId]
  let pool: Pool
  let connection: PoolClient
  let afterRowRead: (() => Promise<void>) | undefined

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema + ',public' })
    await pool.query('CREATE SCHEMA "' + schema + '"')
    await pool.query('CREATE TABLE access_logs (id text PRIMARY KEY, tenant_id text, organization_id text, context_json jsonb, legacy_json json)')
    await pool.query('CREATE TABLE encryption_maps (id text PRIMARY KEY, entity_id text, tenant_id text, organization_id text, fields_json jsonb, is_active boolean, deleted_at timestamptz, created_at timestamptz)')
    const fieldsJson = [{ field: 'context_json' }, { field: 'legacy_json' }]
    const map = Object.assign(new EncryptionMap(), { entityId: 'audit_logs:access_log', tenantId, organizationId, fieldsJson })
    await pool.query('INSERT INTO encryption_maps VALUES ($1, $2, $3, $4, $5, true, NULL, now())',
      ['test-map', map.entityId, tenantId, organizationId, JSON.stringify(fieldsJson)])

    connection = await pool.connect()
    const metadata = {
      className: 'AccessLog', name: 'AccessLog', tableName: 'access_logs', schema, primaryKeys: ['id'],
      properties: {
        contextJson: { name: 'contextJson', fieldNames: ['context_json'], columnTypes: ['jsonb'] },
        legacyJson: { name: 'legacyJson', fieldNames: ['legacy_json'], columnTypes: ['json'] },
      },
    }
    const execute = async (sql: string, parameters: unknown[] = []) => {
      const result = await connection.query(platform.formatQuery(sql, parameters))
      if (afterRowRead && result.rows.length && sql.toLowerCase().startsWith('select') && sql.includes(table)) {
        const callback = afterRowRead
        afterRowRead = undefined
        await callback()
      }
      return result.rows
    }
    mockManager = {
      execute,
      find: async (entity: unknown) => entity === EncryptionMap ? [map] : [],
      getMetadata: () => ({ getAll: () => [metadata] }),
      getConnection: () => ({ execute }),
    }
  })

  beforeEach(async () => {
    afterRowRead = undefined
    await pool.query('DELETE FROM access_logs')
  })

  afterAll(async () => {
    connection?.release()
    if (pool) {
      await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE')
      await pool.end()
    }
  })

  const run = async (command: string, flags: string[]) => {
    const commands = (await import('../cli')).default
    await commands.find((candidate) => candidate.command === command)!.run([...scope, ...flags])
  }

  test('rotates JSONB and legacy JSON ciphertext strings and decrypts their values', async () => {
    const oldKey = pbkdf2Sync(createHash('sha256').update(oldRoot).digest(), tenantId, 310_000, 32, 'sha512').toString('base64')
    const jsonbCiphertext = encryptWithAesGcm('{"synthetic":[1,2]}', oldKey).value
    const jsonCiphertext = encryptWithAesGcm('["synthetic"]', oldKey).value
    await pool.query('INSERT INTO access_logs VALUES ($1, $2, $3, $4, $5)',
      ['row-1', tenantId, organizationId, JSON.stringify(jsonbCiphertext), JSON.stringify(jsonCiphertext)])

    await run('rotate-encryption-key', ['--acknowledge-unprotected-key-rotation', '--allow-unsafe-old-key', '--old-key', oldRoot])

    const rotated = (await pool.query('SELECT context_json, legacy_json FROM access_logs')).rows[0]
    expect(decryptWithAesGcm(rotated.context_json, mockKey)).toBe('{"synthetic":[1,2]}')
    expect(decryptWithAesGcm(rotated.legacy_json, mockKey)).toBe('["synthetic"]')
    expect(decryptWithAesGcm(rotated.context_json, oldKey)).toBeNull()

    await run('decrypt-database', ['--confirm', tenantId])
    expect((await pool.query('SELECT context_json, legacy_json FROM access_logs')).rows).toEqual([
      { context_json: { synthetic: [1, 2] }, legacy_json: ['synthetic'] },
    ])
  })

  test.each([
    ['object integer', '{"number":9007199254740993}', ['number'], '9007199254740993'],
    ['array integer', '[9007199254740993]', ['0'], '9007199254740993'],
    ['object decimal', '{"number":0.123456789012345678901234567890}', ['number'], '0.123456789012345678901234567890'],
  ])('preserves exact %s through old-key rotation and new-key decryption', async (_description, plaintext, jsonPath, expected) => {
    const oldKey = pbkdf2Sync(createHash('sha256').update(oldRoot).digest(), tenantId, 310_000, 32, 'sha512').toString('base64')
    const ciphertext = encryptWithAesGcm(String(plaintext), oldKey).value
    await pool.query('INSERT INTO access_logs VALUES ($1, $2, $3, $4, $5)',
      ['row-1', tenantId, organizationId, JSON.stringify(ciphertext), JSON.stringify(ciphertext)])

    await run('rotate-encryption-key', ['--acknowledge-unprotected-key-rotation', '--allow-unsafe-old-key', '--old-key', oldRoot])

    const rotated = (await pool.query('SELECT context_json, legacy_json FROM access_logs')).rows[0]
    for (const envelope of [rotated.context_json, rotated.legacy_json]) {
      expect(decryptWithAesGcm(envelope, mockKey)).toBe(plaintext)
      expect(decryptWithAesGcm(envelope, oldKey)).toBeNull()
    }

    await run('decrypt-database', ['--confirm', tenantId])

    expect((await pool.query(
      'SELECT context_json #>> $1::text[] AS jsonb_number, legacy_json #>> $1::text[] AS json_number FROM access_logs',
      [jsonPath],
    )).rows).toEqual([{ jsonb_number: expected, json_number: expected }])
  })

  test.each([
    ['ordinary text', 'hello world', 'hello world'],
    ['JSON boolean text', 'true', 'true'],
    ['JSON null text', 'null', 'null'],
    ['JSON number text', '123', '123'],
    ['legacy quoted empty text', '""', ''],
    ['quoted text', '"hello world"', 'hello world'],
    ['quoted boolean text', '"true"', 'true'],
    ['quoted object text', JSON.stringify('{"synthetic":1}'), '{"synthetic":1}'],
    ['quoted array text', JSON.stringify('[1,2]'), '[1,2]'],
    ['structured object', '{"synthetic":[1,2]}', { synthetic: [1, 2] }],
    ['structured array', '["synthetic"]', ['synthetic']],
  ])('decrypts %s without changing its JSON column type', async (_description, plaintext, expected) => {
    const ciphertext = encryptWithAesGcm(String(plaintext), mockKey).value
    await pool.query('INSERT INTO access_logs VALUES ($1, $2, $3, $4, $5)',
      ['row-1', tenantId, organizationId, JSON.stringify(ciphertext), JSON.stringify(ciphertext)])

    await run('decrypt-database', ['--confirm', tenantId])

    expect((await pool.query('SELECT context_json, legacy_json FROM access_logs')).rows).toEqual([
      { context_json: expected, legacy_json: expected },
    ])
  })

  test('preserves exact numbers in decrypted structured JSON', async () => {
    const plaintext = '{"number": 9007199254740993}'
    const ciphertext = encryptWithAesGcm(plaintext, mockKey).value
    await pool.query('INSERT INTO access_logs VALUES ($1, $2, $3, $4, $5)',
      ['row-1', tenantId, organizationId, JSON.stringify(ciphertext), JSON.stringify(ciphertext)])

    await run('decrypt-database', ['--confirm', tenantId])

    expect((await pool.query("SELECT context_json->>'number' AS jsonb_number, legacy_json->>'number' AS json_number FROM access_logs")).rows).toEqual([
      { jsonb_number: '9007199254740993', json_number: '9007199254740993' },
    ])
  })

  test('rejects a concurrent JSONB number change that JavaScript rounds to the same value', async () => {
    await pool.query('INSERT INTO access_logs VALUES ($1, $2, $3, $4, NULL)',
      ['row-1', tenantId, organizationId, '9007199254740992'])
    afterRowRead = async () => {
      await pool.query('UPDATE access_logs SET context_json = $1 WHERE id = $2', ['9007199254740993', 'row-1'])
    }

    await expect(run('rotate-encryption-key', ['--acknowledge-unprotected-key-rotation'])).rejects.toThrow('changed concurrently')
    expect((await pool.query('SELECT context_json::text AS snapshot FROM access_logs')).rows).toEqual([
      { snapshot: '9007199254740993' },
    ])
  })
})
