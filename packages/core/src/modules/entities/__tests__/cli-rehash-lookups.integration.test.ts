import { randomBytes, randomUUID } from 'node:crypto'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import { hash } from 'bcryptjs'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { encryptWithAesGcm, hashForLookup, legacyHashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { registerTenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { EncryptionKeyScope } from '@open-mercato/shared/modules/encryption'
import type { StartedTestContainer } from 'testcontainers'
import cli from '../cli'
import { EncryptionMap } from '../data/entities'

let mockEm: EntityManager
let mockEncryption: TenantDataEncryptionService

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'em') return mockEm
      if (name === 'tenantEncryptionService') return mockEncryption
      throw new Error(`[internal] Unknown dependency ${name}`)
    },
  }),
}))

jest.mock('../lib/install-from-ce', () => ({}))

const command = cli.find(({ command }) => command === 'rehash-lookups')!
const databaseUrl = process.env.OM_ENCRYPTION_MAINTENANCE_TEST_DATABASE_URL
const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('lookup pepper rotation in PostgreSQL', () => {
  const originalEnv = { ...process.env }
  const tenantId = randomUUID()
  const otherTenantId = randomUUID()
  const organizationId = randomUUID()
  const dek = randomBytes(32).toString('base64')
  const systemDek = randomBytes(32).toString('base64')
  const database = `rehash_${randomUUID().replaceAll('-', '')}`
  let orm: MikroORM
  let admin: Client
  let postgres: StartedTestContainer | undefined

  function registerDefaultMap(keyScope?: EncryptionKeyScope) {
    registerCliModules([{
      id: 'auth',
      defaultEncryptionMaps: [{ entityId: 'auth:user', keyScope, fields: [{ field: 'email', hashField: 'email_hash' }] }],
    }])
  }

  beforeAll(async () => {
    let url: URL
    if (databaseUrl) {
      url = new URL(databaseUrl)
    } else {
      const { GenericContainer, Wait } = await import('testcontainers')
      const password = randomBytes(24).toString('hex')
      postgres = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_PASSWORD: password })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .start()
      url = new URL(`postgres://postgres@${postgres.getHost()}:${postgres.getMappedPort(5432)}/postgres`)
      url.password = password
    }
    admin = new Client({ connectionString: url.toString() })
    await admin.connect()
    await admin.query(`CREATE DATABASE "${database}"`)
    url.pathname = `/${database}`
    orm = await MikroORM.init({ clientUrl: url.toString(), entities: [User, EncryptionMap] })
    await orm.schema.create()
    registerEntityIds({ auth: { user: 'auth:user' } })
  }, 120_000)

  afterAll(async () => {
    registerCliModules([])
    await orm?.close(true)
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`)
      await admin.end()
    }
    await postgres?.stop()
  })

  beforeEach(async () => {
    registerDefaultMap()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.LOOKUP_HASH_PEPPER = 'original-test-pepper'
    delete process.env.LOOKUP_HASH_OLD_PEPPER
    mockEm = orm.em.fork()
    mockEncryption = new TenantDataEncryptionService(mockEm, { kms: {
      isHealthy: () => true,
      getTenantDek: async (keyId) => ({ tenantId: keyId, key: keyId === 'system:auth:user' ? systemDek : dek, fetchedAt: Date.now() }),
      createTenantDek: async () => { throw new Error('Rehash must not provision any keys') },
    } })
    await mockEm.execute('TRUNCATE users, encryption_maps')
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  async function insertUser(email: string, tenant: string | null, values: {
    organization?: string
    encrypted?: boolean
    key?: string
    storedHash?: string | null
    passwordHash?: string
  } = {}) {
    const id = randomUUID()
    const storedEmail = values.encrypted ? encryptWithAesGcm(email, values.key ?? dek).value : email
    const storedHash = values.storedHash === undefined ? hashForLookup(email) : values.storedHash
    await mockEm.execute(
      'INSERT INTO users (id, tenant_id, organization_id, email, email_hash, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [id, tenant, values.organization ?? null, storedEmail, storedHash, values.passwordHash ?? null],
    )
    return { id, storedEmail, storedHash }
  }

  async function readUser(id: string) {
    const [row] = await mockEm.execute<Array<{ email: string; email_hash: string | null }>>('SELECT email, email_hash FROM users WHERE id = ?', [id])
    return row
  }

  async function readUserVersion(id: string) {
    const [row] = await mockEm.execute<Array<{ updated_at: string | null }>>('SELECT updated_at FROM users WHERE id = ?', [id])
    return row!.updated_at === null ? null : new Date(row!.updated_at)
  }

  function switchPeppers() {
    process.env.LOOKUP_HASH_OLD_PEPPER = process.env.LOOKUP_HASH_PEPPER
    process.env.LOOKUP_HASH_PEPPER = 'replacement-test-pepper'
  }

  it('advances record versions only when a lookup hash changes', async () => {
    const versioned = await insertUser('versioned@example.test', tenantId)
    const unversioned = await insertUser('unversioned@example.test', tenantId)
    const originalVersion = new Date(0)
    await mockEm.execute('UPDATE users SET updated_at = ? WHERE id = ?', [originalVersion, versioned.id])
    expect(await readUserVersion(unversioned.id)).toBeNull()
    switchPeppers()

    await command.run(['--tenant', tenantId, '--dry-run'])
    expect(await readUserVersion(versioned.id)).toEqual(originalVersion)
    expect(await readUserVersion(unversioned.id)).toBeNull()

    await command.run(['--tenant', tenantId])
    const updatedVersion = await readUserVersion(versioned.id)
    const initializedVersion = await readUserVersion(unversioned.id)
    expect(updatedVersion).toBeInstanceOf(Date)
    expect(updatedVersion!.getTime()).toBeGreaterThan(originalVersion.getTime())
    expect(initializedVersion).toBeInstanceOf(Date)

    await command.run(['--tenant', tenantId])
    expect(await readUserVersion(versioned.id)).toEqual(updatedVersion)
    expect(await readUserVersion(unversioned.id)).toEqual(initializedVersion)
  })

  it('keeps the staff login lookup working and rehashes only the selected tenant across keyset batches', async () => {
    const email = 'operator@example.test'
    const password = 'test-only-password'
    const current = await insertUser(email, tenantId, { organization: organizationId, encrypted: true, passwordHash: await hash(password, 4) })
    const legacyEmail = 'legacy@example.test'
    const legacy = await insertUser(legacyEmail, tenantId, { storedHash: legacyHashForLookup(legacyEmail) })
    const withoutHash = await insertUser('no-hash@example.test', tenantId, { storedHash: null })
    const empty = await insertUser('', tenantId, { encrypted: true })
    const other = await insertUser(email, otherTenantId, { encrypted: true })
    await mockEm.execute('INSERT INTO encryption_maps (entity_id, tenant_id, fields_json, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [
      'auth:user', tenantId, JSON.stringify([{ field: 'email', hashField: 'email_hash' }]),
    ])
    await mockEm.getKysely<Record<string, Record<string, unknown>>>().insertInto('users')
      .values(Array.from({ length: 500 }, (_, index) => {
        const email = `batch-${index}@example.test`
        return { tenant_id: tenantId, email, email_hash: hashForLookup(email), created_at: new Date() }
      }))
      .execute()
    switchPeppers()
    registerTenantEncryptionSubscriber(mockEm, mockEncryption)
    const auth = () => new AuthService(mockEm.fork())
    const before = await auth().findUserByEmailAndTenant(email, tenantId)
    expect(before?.id).toBe(current.id)
    expect(await auth().verifyPassword(before, password)).toBe(true)

    await command.run(['--tenant', tenantId, '--dry-run'])
    expect(await readUser(current.id)).toEqual({ email: current.storedEmail, email_hash: current.storedHash })

    await command.run(['--tenant', tenantId.toUpperCase()])
    delete process.env.LOOKUP_HASH_OLD_PEPPER
    expect(await auth().findUserByEmailAndTenant(email, tenantId)).toMatchObject({ id: current.id, email })
    expect(await readUser(current.id)).toEqual({ email: current.storedEmail, email_hash: hashForLookup(email) })
    expect(await readUser(legacy.id)).toEqual({ email: legacyEmail, email_hash: hashForLookup(legacyEmail) })
    expect(await readUser(withoutHash.id)).toMatchObject({ email_hash: null })
    expect(await readUser(empty.id)).toEqual({ email: empty.storedEmail, email_hash: hashForLookup('') })
    expect(await readUser(other.id)).toEqual({ email: other.storedEmail, email_hash: other.storedHash })
    const remaining = await mockEm.execute('SELECT id FROM users WHERE tenant_id = ? AND email_hash = ?', [tenantId, current.storedHash])
    expect(remaining).toEqual([])

    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    await command.run(['--tenant', tenantId])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Rows updated: 0.'))
  })

  it('uses the system key for tenantless rows and keeps tenant rows out of the tenantless run', async () => {
    registerDefaultMap('system')
    const email = 'onboarding@example.test'
    const pending = await insertUser(email, null, { encrypted: true, key: systemDek })
    const onboarded = await insertUser(email, tenantId, { encrypted: true, key: systemDek })
    switchPeppers()

    await expect(command.run([])).rejects.toThrow('Usage:')
    await expect(command.run(['--tenant', tenantId, '--tenantless'])).rejects.toThrow('Usage:')
    await command.run(['--tenantless'])
    expect(await readUser(pending.id)).toEqual({ email: pending.storedEmail, email_hash: hashForLookup(email) })
    expect(await readUser(onboarded.id)).toEqual({ email: onboarded.storedEmail, email_hash: onboarded.storedHash })
    await command.run(['--tenant', tenantId])
    expect(await readUser(onboarded.id)).toEqual({ email: onboarded.storedEmail, email_hash: hashForLookup(email) })
  })

  it('uses the effective organization mapping when it overrides a default hash column', async () => {
    const alternate = 'alternate@example.test'
    const email = 'primary@example.test'
    const overridden = await insertUser(email, tenantId, { organization: organizationId, storedHash: hashForLookup(alternate) })
    const historical = await insertUser(email, tenantId, { organization: organizationId })
    const regular = await insertUser(email, tenantId, { organization: randomUUID() })
    await mockEm.execute('UPDATE users SET name = ? WHERE id IN (?, ?)', [alternate, overridden.id, historical.id])
    await mockEm.execute('INSERT INTO encryption_maps (entity_id, tenant_id, organization_id, fields_json, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())', [
      'auth:user', tenantId, organizationId, JSON.stringify([{ field: 'name', hashField: 'emailHash' }]),
    ])

    switchPeppers()
    await command.run(['--tenant', tenantId])
    expect(await readUser(overridden.id)).toEqual({ email, email_hash: hashForLookup(alternate) })
    expect(await readUser(historical.id)).toEqual({ email, email_hash: hashForLookup(email) })
    expect(await readUser(regular.id)).toEqual({ email, email_hash: hashForLookup(email) })
  })

  it('preserves a concurrent edit and rejects ciphertext sealed under an unavailable key', async () => {
    const original = await insertUser('original@example.test', tenantId)
    switchPeppers()
    const editedEmail = 'edited@example.test'
    const editedHash = hashForLookup(editedEmail)
    const editedVersion = new Date(1)
    const resolveRules = mockEncryption.getLookupHashRules.bind(mockEncryption)
    const concurrentEdit = jest.spyOn(mockEncryption, 'getLookupHashRules').mockImplementationOnce(async (...args) => {
      await orm.em.fork().execute('UPDATE users SET email = ?, email_hash = ?, updated_at = ? WHERE id = ?', [editedEmail, editedHash, editedVersion, original.id])
      return resolveRules(...args)
    })

    await expect(command.run(['--tenant', tenantId])).rejects.toThrow('changed concurrently')
    expect(await readUser(original.id)).toEqual({ email: editedEmail, email_hash: editedHash })
    expect(await readUserVersion(original.id)).toEqual(editedVersion)
    concurrentEdit.mockRestore()

    const unreadable = await insertUser('unreadable@example.test', tenantId, { encrypted: true, key: randomBytes(32).toString('base64') })
    await expect(command.run(['--tenant', tenantId])).rejects.toThrow('Cannot decrypt auth:user.email')
    expect(await readUser(unreadable.id)).toEqual({ email: unreadable.storedEmail, email_hash: unreadable.storedHash })
  })

  it('refuses to overwrite a lookup hash that cannot be verified with either pepper', async () => {
    const unreadable = await insertUser('mailbox@example.test', tenantId)
    switchPeppers()
    process.env.LOOKUP_HASH_OLD_PEPPER = 'wrong-test-pepper'

    await expect(command.run(['--tenant', tenantId])).rejects.toThrow('does not match its mapped sources')
    expect(await readUser(unreadable.id)).toEqual({ email: unreadable.storedEmail, email_hash: unreadable.storedHash })
  })
})
