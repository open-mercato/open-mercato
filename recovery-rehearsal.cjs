const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const test = require('node:test')
const { createKmsService, encryptWithAesGcm, decryptWithAesGcmStrict, hashForLookup, lookupHashCandidates } = require('./runtime.cjs')
process.env.NODE_ENV = 'production'
process.env.TENANT_DATA_ENCRYPTION = 'true'
process.env.OM_LOG_LEVEL = 'error'
delete process.env.VAULT_ADDR
delete process.env.VAULT_TOKEN
const oldRoot = randomBytes(32).toString('hex')
const oldPepper = randomBytes(32).toString('hex')
const newRoot = randomBytes(32).toString('hex')
const newPepper = randomBytes(32).toString('hex')
function configure(root, pepper) {
  process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = root
  process.env.LOOKUP_HASH_PEPPER = pepper
  delete process.env.TENANT_DATA_ENCRYPTION_KEY
  return createKmsService()
}
async function dek(service, scope) {
  const keyScope = scope.startsWith('tenant-a:') ? 'tenant-a' : scope.startsWith('tenant-b:') ? 'tenant-b' : scope
  const result = await service.getTenantDek(keyScope)
  assert.ok(result)
  return result.key
}
const scopes = ['tenant-a:organization-one', 'tenant-a:null-organization', 'tenant-b:organization-two', 'system:onboarding']
const context = 'auth:user.email'
let backup
let migrated

test('old snapshot and retained keys restore tenant, null-organization, system and nested credential records', async () => {
  const kms = configure(oldRoot, oldPepper)
  backup = await Promise.all(scopes.map(async scope => {
    const key = await dek(kms, scope)
    const plaintext = `${scope}@fixture.example.test`
    const inner = encryptWithAesGcm('owner-managed-credential', key).value
    const ciphertext = encryptWithAesGcm(JSON.stringify({ email: plaintext, inner }), key).value
    return { scope, ciphertext, hash: hashForLookup(plaintext, context) }
  }))
  fs.writeFileSync('/tmp/encrypted-backup.json', JSON.stringify(backup), { mode: 0o600 })
  backup = JSON.parse(fs.readFileSync('/tmp/encrypted-backup.json', 'utf8'))
  const recovered = configure(oldRoot, oldPepper)
  for (const row of backup) {
    const key = await dek(recovered, row.scope)
    const payload = JSON.parse(decryptWithAesGcmStrict(row.ciphertext, key))
    assert.equal(payload.email, `${row.scope}@fixture.example.test`)
    assert.equal(decryptWithAesGcmStrict(payload.inner, key), 'owner-managed-credential')
    assert.equal(row.hash, hashForLookup(payload.email, context))
  }
})

test('changing only the active root/pepper cannot decrypt old data or match old keyed lookups', async () => {
  const target = configure(newRoot, newPepper)
  for (const row of backup) {
    const key = await dek(target, row.scope)
    assert.throws(() => decryptWithAesGcmStrict(row.ciphertext, key))
    assert.ok(!lookupHashCandidates(`${row.scope}@fixture.example.test`, context).includes(row.hash))
  }
})

test('offline owner-assisted reseal and complete lookup backfill produce target-only readable data', async () => {
  const old = configure(oldRoot, oldPepper)
  const oldKeys = new Map(await Promise.all(scopes.map(async scope => [scope, await dek(old, scope)])))
  const target = configure(newRoot, newPepper)
  migrated = []
  for (const row of backup) {
    const oldKey = oldKeys.get(row.scope)
    const payload = JSON.parse(decryptWithAesGcmStrict(row.ciphertext, oldKey))
    const targetKey = await dek(target, row.scope)
    const innerPlaintext = decryptWithAesGcmStrict(payload.inner, oldKey)
    payload.inner = encryptWithAesGcm(innerPlaintext, targetKey).value
    migrated.push({ scope: row.scope, ciphertext: encryptWithAesGcm(JSON.stringify(payload), targetKey).value,
      hash: hashForLookup(payload.email, context) })
  }
  delete process.env.TENANT_DATA_ENCRYPTION_OLD_KEY
  const targetOnly = configure(newRoot, newPepper)
  for (const row of migrated) {
    const key = await dek(targetOnly, row.scope)
    const payload = JSON.parse(decryptWithAesGcmStrict(row.ciphertext, key))
    assert.equal(decryptWithAesGcmStrict(payload.inner, key), 'owner-managed-credential')
    assert.ok(lookupHashCandidates(payload.email, context).includes(row.hash))
    assert.notEqual(row.hash, backup.find(original => original.scope === row.scope).hash)
    const otherScope = row.scope.startsWith('tenant-a:') ? 'tenant-b:organization-two' : 'tenant-a:organization-one'
    const otherKey = await dek(targetOnly, otherScope)
    assert.throws(() => decryptWithAesGcmStrict(row.ciphertext, otherKey))
  }
})

test('outer-only reseal leaves an unreadable old credential envelope and must remain in maintenance', async () => {
  const old = configure(oldRoot, oldPepper)
  const source = backup[0]
  const payload = JSON.parse(decryptWithAesGcmStrict(source.ciphertext, await dek(old, source.scope)))
  const target = configure(newRoot, newPepper)
  const targetKey = await dek(target, source.scope)
  const outer = encryptWithAesGcm(JSON.stringify(payload), targetKey).value
  const partiallyMigrated = JSON.parse(decryptWithAesGcmStrict(outer, targetKey))
  assert.throws(() => decryptWithAesGcmStrict(partiallyMigrated.inner, targetKey))
})

test('consistent snapshot rollback restores data plus matching old keys/pepper; secret-only rollback fails', async () => {
  const old = configure(oldRoot, oldPepper)
  for (const row of migrated) {
    const wrongKey = await dek(old, row.scope)
    assert.throws(() => decryptWithAesGcmStrict(row.ciphertext, wrongKey))
  }
  for (const row of backup) {
    const payload = JSON.parse(decryptWithAesGcmStrict(row.ciphertext, await dek(old, row.scope)))
    assert.equal(hashForLookup(payload.email, context), row.hash)
  }
})


test('PostgreSQL encrypted snapshot restores consistent ciphertext/hashes and owner-assisted target-only cutover', async () => {
  const { Client } = require('/workspace/node_modules/pg')
  const client = new Client({ host: 'om8377-recovery-postgres', user: 'postgres', database: 'om8377_fixture' })
  await client.connect()
  try {
    await client.query('CREATE TABLE encrypted_fixture (scope text PRIMARY KEY, ciphertext text NOT NULL, lookup_hash text UNIQUE NOT NULL)')
    for (const row of backup) {
      await client.query('INSERT INTO encrypted_fixture VALUES ($1, $2, $3)', [row.scope, row.ciphertext, row.hash])
    }
    await client.query('CREATE TABLE encrypted_snapshot AS TABLE encrypted_fixture')
    await client.query('BEGIN')
    for (const row of migrated) {
      await client.query('UPDATE encrypted_fixture SET ciphertext=$2, lookup_hash=$3 WHERE scope=$1', [row.scope, row.ciphertext, row.hash])
    }
    await client.query('COMMIT')
    const target = configure(newRoot, newPepper)
    for (const expected of migrated) {
      const selected = await client.query('SELECT * FROM encrypted_fixture WHERE lookup_hash=$1 AND scope=$2', [expected.hash, expected.scope])
      assert.equal(selected.rowCount, 1)
      const payload = JSON.parse(decryptWithAesGcmStrict(selected.rows[0].ciphertext, await dek(target, expected.scope)))
      assert.equal(payload.email, `${expected.scope}@fixture.example.test`)
      assert.equal(hashForLookup(payload.email, context), selected.rows[0].lookup_hash)
      assert.equal(decryptWithAesGcmStrict(payload.inner, await dek(target, expected.scope)), 'owner-managed-credential')
      const duplicate = await client.query('SELECT count(*)::int AS count FROM encrypted_fixture WHERE lookup_hash=$1', [hashForLookup(payload.email, context)])
      assert.equal(duplicate.rows[0].count, 1)
    }
    await assert.rejects(client.query('INSERT INTO encrypted_fixture VALUES ($1, $2, $3)', ['duplicate-fixture', migrated[0].ciphertext, migrated[0].hash]), { code: '23505' })
    await client.query('BEGIN')
    await client.query('TRUNCATE encrypted_fixture')
    await client.query('INSERT INTO encrypted_fixture SELECT * FROM encrypted_snapshot')
    await client.query('COMMIT')
    const restored = await client.query('SELECT * FROM encrypted_fixture')
    const recovered = configure(oldRoot, oldPepper)
    assert.equal(restored.rowCount, backup.length)
    for (const row of restored.rows) {
      const payload = JSON.parse(decryptWithAesGcmStrict(row.ciphertext, await dek(recovered, row.scope)))
      assert.equal(hashForLookup(payload.email, context), row.lookup_hash)
      assert.equal(decryptWithAesGcmStrict(payload.inner, await dek(recovered, row.scope)), 'owner-managed-credential')
    }
    console.log('Synthetic PostgreSQL fixture: 4 scoped encrypted rows, target-only read/hash/unique checks and matching snapshot rollback passed')
  } finally {
    await client.end()
  }
})
