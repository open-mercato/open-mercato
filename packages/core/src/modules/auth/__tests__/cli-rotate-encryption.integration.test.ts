/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const databaseUrl = process.env.OM_ENCRYPTION_MAINTENANCE_TEST_DATABASE_URL
const describePostgres = process.env.OM_PG_INTEGRATION === '1' && databaseUrl ? describe : describe.skip
let mockManager: unknown
const mockDecrypt = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => mockManager }),
}))
jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  decryptWithAesGcm: (payload: string, key: string) => mockDecrypt(payload, key),
}))
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => true,
  isEncryptionDebugEnabled: () => false,
}))
jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => true,
    getDek: async (tenantId: string) => ({ tenantId, key: 'current-key', fetchedAt: 0 }),
    encryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => ({
      email: `encrypted:${payload.email}`,
      emailHash: 'replacement-hash',
    }),
  })),
}))

describePostgres('auth email maintenance compare-and-swap in PostgreSQL', () => {
  let pool: Pool
  let schema: string
  let afterRead: (() => Promise<void>) | undefined
  const originalEmail = 'iv:cipher:tag:v1'
  const run = async (rotate = true) => {
    const commands = (await import('../cli')).default
    await commands.find((command) => command.command === 'rotate-encryption-key')!.run([
      '--tenant', 'tenant-1', '--org', 'org-1', ...(rotate ? ['--allow-unsafe-old-key', '--old-key', 'test-only-old-key'] : []),
    ])
  }

  beforeEach(async () => {
    mockDecrypt.mockReset().mockReturnValue('original@example.test')
    schema = `auth_rotation_${randomUUID().replaceAll('-', '')}`
    pool = new Pool({ connectionString: databaseUrl })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`CREATE TABLE "${schema}".users (id text PRIMARY KEY, tenant_id text, organization_id text, email text, email_hash text, display_name text, updated_at timestamptz NOT NULL DEFAULT '2020-01-01T00:00:00Z')`)
    await pool.query(`INSERT INTO "${schema}".users VALUES ('user-1', 'tenant-1', 'org-1', $1, NULL, 'Original name', DEFAULT)`, [originalEmail])
    afterRead = undefined
    mockManager = {
      getConnection: () => ({
        execute: async (statement: string, parameters: unknown[] = []) => {
          let parameterIndex = 0
          const result = await pool.query(statement.replace(/\?/g, () => `$${++parameterIndex}`), parameters)
          if (afterRead && statement.startsWith('select id, email, email_hash')) {
            const callback = afterRead
            afterRead = undefined
            await callback()
          }
          return result.rows
        },
      }),
      getMetadata: () => ({ get: () => ({ tableName: 'users', schema }) }),
    }
  })

  afterEach(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } finally {
        await pool.end()
      }
    }
  })

  it.each([null, 'original-hash'])('rotates unchanged ciphertext with original hash %s', async (originalHash) => {
    await pool.query(`UPDATE "${schema}".users SET email_hash = $1`, [originalHash])
    const previousVersion = (await pool.query(`SELECT updated_at FROM "${schema}".users`)).rows[0].updated_at as Date
    await run()
    const updatedVersion = (await pool.query(`SELECT updated_at FROM "${schema}".users`)).rows[0].updated_at as Date
    expect(updatedVersion.getTime()).toBeGreaterThan(previousVersion.getTime())
    expect((await pool.query(`SELECT email, email_hash, display_name FROM "${schema}".users`)).rows).toEqual([
      { email: 'encrypted:original@example.test', email_hash: 'replacement-hash', display_name: 'Original name' },
    ])
  })

  it.each([
    ['email', 'new@example.test'],
    ['email_hash', 'concurrent-hash'],
    ['tenant_id', 'tenant-2'],
    ['organization_id', 'org-2'],
  ])('preserves a concurrent %s change and rejects the stale write', async (column, replacement) => {
    const concurrentVersion = new Date('2021-01-01T00:00:00Z')
    afterRead = async () => {
      await pool.query(`UPDATE "${schema}".users SET ${column} = $1, updated_at = $2 WHERE id = 'user-1'`, [replacement, concurrentVersion])
    }
    await expect(run()).rejects.toThrow('A row changed concurrently during auth encryption maintenance')
    const expected = { email: originalEmail, email_hash: null, tenant_id: 'tenant-1', organization_id: 'org-1', updated_at: concurrentVersion, [column]: replacement }
    expect((await pool.query(`SELECT email, email_hash, tenant_id, organization_id, updated_at FROM "${schema}".users`)).rows).toEqual([expected])
  })

  it('does not overwrite a concurrent plaintext email change during initial encryption', async () => {
    await pool.query(`UPDATE "${schema}".users SET email = 'original@example.test'`)
    afterRead = async () => {
      await pool.query(`UPDATE "${schema}".users SET email = 'new@example.test', email_hash = 'new-hash'`)
    }
    await expect(run(false)).rejects.toThrow('A row changed concurrently during auth encryption maintenance')
    expect((await pool.query(`SELECT email, email_hash FROM "${schema}".users`)).rows).toEqual([
      { email: 'new@example.test', email_hash: 'new-hash' },
    ])
    await run(false)
    expect((await pool.query(`SELECT email, email_hash FROM "${schema}".users`)).rows).toEqual([
      { email: 'encrypted:new@example.test', email_hash: 'replacement-hash' },
    ])
  })

  it('preserves unrelated edits while rotating the selected email', async () => {
    afterRead = async () => {
      await pool.query(`UPDATE "${schema}".users SET display_name = 'Concurrent name'`)
    }
    await run()
    expect((await pool.query(`SELECT email, display_name FROM "${schema}".users`)).rows).toEqual([
      { email: 'encrypted:original@example.test', display_name: 'Concurrent name' },
    ])
  })

  it('rejects a row deleted after the read', async () => {
    afterRead = async () => { await pool.query(`DELETE FROM "${schema}".users`) }
    await expect(run()).rejects.toThrow('A row changed concurrently during auth encryption maintenance')
    expect((await pool.query(`SELECT * FROM "${schema}".users`)).rows).toEqual([])
  })

  it.each(['current-key', 'unrecoverable'])('preserves persisted %s ciphertext, hash and version', async (keyState) => {
    await pool.query(`UPDATE "${schema}".users SET email_hash = 'original-hash'`)
    const before = (await pool.query(`SELECT email, email_hash, updated_at FROM "${schema}".users`)).rows
    mockDecrypt.mockImplementation((_payload: string, key: string) =>
      keyState === 'current-key' && key === 'current-key' ? 'original@example.test' : null)

    if (keyState === 'current-key') {
      await expect(run()).resolves.toBeUndefined()
    } else {
      await expect(run()).rejects.toThrow('1 auth user email(s) could not be rotated')
    }

    expect((await pool.query(`SELECT email, email_hash, updated_at FROM "${schema}".users`)).rows).toEqual(before)
    expect(mockDecrypt).toHaveBeenCalledTimes(2)
  })

  it('persists only recoverable updates and rejects a mixed partial rotation', async () => {
    const recoverableEmail = 'iv:old:tag:v1'
    const currentEmail = 'iv:current:tag:v1'
    await pool.query(`INSERT INTO "${schema}".users VALUES
      ('user-2', 'tenant-1', 'org-1', $1, 'old-hash', 'Recoverable', DEFAULT),
      ('user-3', 'tenant-1', 'org-1', $2, 'current-hash', 'Already current', DEFAULT)`,
    [recoverableEmail, currentEmail])
    const untouchedBefore = (await pool.query(`SELECT * FROM "${schema}".users WHERE id != 'user-2' ORDER BY id`)).rows
    mockDecrypt.mockImplementation((payload: string, key: string) => {
      if (payload === recoverableEmail) return 'recoverable@example.test'
      if (payload === currentEmail && key === 'current-key') return 'current@example.test'
      return null
    })

    await expect(run()).rejects.toThrow('1 auth user email(s) could not be rotated')

    expect((await pool.query(`SELECT * FROM "${schema}".users WHERE id != 'user-2' ORDER BY id`)).rows).toEqual(untouchedBefore)
    const recovered = (await pool.query(`SELECT email, email_hash, updated_at FROM "${schema}".users WHERE id = 'user-2'`)).rows[0]
    expect(recovered.email).toBe('encrypted:recoverable@example.test')
    expect(recovered.email_hash).toBe('replacement-hash')
    expect((recovered.updated_at as Date).getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime())
  })
})
