import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertEncryptionCompatible, inspectEncryptionCompatibility } from '../encryption-preflight.mjs'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'

const correct = Buffer.alloc(32, 1).toString('base64')
const wrong = Buffer.alloc(32, 2).toString('base64')
const tenant = 'scope-fixture'
const sealed = encryptWithAesGcm('private-fixture', correct).raw

function fixture(records, options = {}) {
  const queries = []
  let fetched = false
  const client = { async query(sql) {
    queries.push(sql)
    if (sql.includes('FROM pg_class')) return { rows: [{ schema: 'public', name: options.table ?? 'fixture', kind: 'r', column: 'value', type: 'text', rls: false, ...options.metadata }] }
    if (sql.startsWith('FETCH')) { const rows = fetched ? [] : records.map(record => ({ record: structuredClone(record) })); fetched = true; return { rows } }
    return { rows: [] }
  } }
  const keyReads = []
  const kms = {
    isHealthy: () => true,
    async getTenantDek(keyId) { keyReads.push(keyId); return { key: correct } },
    async createTenantDek() { assert.fail('preflight must never create a key') },
  }
  return { client, kms, decrypt: decryptWithAesGcm, resolveKeyId: entityId => `system:${entityId}`, queries, keyReads }
}

test('authenticates actual AES envelopes and nested JSON without any SQL or KMS mutation', async () => {
  const nested = encryptWithAesGcm(JSON.stringify({ inner: sealed }), correct).raw
  const input = fixture([{ tenant_id: tenant, doc: [{ secret: nested }] }])
  assert.equal(await inspectEncryptionCompatibility(input), 'verified')
  assert.deepEqual(input.keyReads, [tenant])
  assert.equal(input.queries.at(-1), 'ROLLBACK')
  assert.ok(input.queries.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
  assert.ok(input.queries.every(sql => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(sql)))
})

test('wrong keys, missing keys and unavailable KMS all reject with transaction rollback', async () => {
  for (const getTenantDek of [async () => ({ key: wrong }), async () => null, async () => { throw new Error('secret-should-not-escape') }]) {
    const input = fixture([{ tenant_id: tenant, value: sealed }])
    input.kms.getTenantDek = getTenantDek
    await assert.rejects(inspectEncryptionCompatibility(input))
    assert.equal(input.queries.at(-1), 'ROLLBACK')
  }
})

test('system-scoped onboarding keeps its system key after tenant assignment', async () => {
  const input = fixture([{ tenant_id: tenant, value: sealed }], { table: 'onboarding_requests' })
  assert.equal(await inspectEncryptionCompatibility(input), 'verified')
  assert.deepEqual(input.keyReads, ['system:onboarding:onboarding_request'])
})

test('empty, plaintext-only and unavailable KMS have distinct safe outcomes', async () => {
  assert.equal(await inspectEncryptionCompatibility(fixture([])), 'empty')
  assert.equal(await inspectEncryptionCompatibility(fixture([{ tenant_id: tenant, value: 'plain' } ])), 'plaintext-only')
  const unavailable = fixture([{ value: 'plain' }])
  unavailable.kms.getTenantDek = async () => null
  await assert.rejects(inspectEncryptionCompatibility(unavailable))
  assert.equal(await inspectEncryptionCompatibility({ ...unavailable, ...fixture([{ value: 'plain' }]), kms: unavailable.kms, encryptionEnabled: false }), 'plaintext-only')
})

test('unknown versions, malformed ciphertext, unknown scope, incomplete scans and RLS fail closed', async () => {
  for (const input of [
    fixture([{ tenant_id: tenant, value: sealed.replace(/v1$/, 'v2') }]),
    fixture([{ tenant_id: tenant, value: 'broken:payload:v1' }]),
    fixture([{ value: sealed }]),
    { ...fixture([{ value: 'plain' }]), maxRows: 0 },
    { ...fixture([{ value: 'plain' }]), maxBytes: 0 },
    fixture([], { metadata: { rls: true } }),
    fixture([], { metadata: { kind: 'f' } }),
    fixture([{ value: '\\x0102' }], { metadata: { type: 'bytea' } }),
  ]) await assert.rejects(inspectEncryptionCompatibility(input))
})

test('wrapper redacts all provider errors and preserves environment bytes on rejection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-encryption-redaction-'))
  try {
    const file = path.join(dir, '.env')
    const before = 'TENANT_DATA_ENCRYPTION_KEY=fixture-secret\n'
    fs.writeFileSync(file, before)
    await assert.rejects(assertEncryptionCompatible({ projectDir: dir, env: {}, runProbe: async () => { throw new Error('fixture-secret https://token@vault.example') } }), error => {
      assert.ok(!error.message.includes('fixture-secret'))
      assert.ok(!error.message.includes('vault.example'))
      return /writes are blocked/.test(error.message)
    })
    assert.equal(fs.readFileSync(file, 'utf8'), before)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('starter rejects incompatible reuse before migration, initialize, marker or env writes', async () => {
  const { databaseStep } = await import('../steps.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-encryption-step-'))
  try {
    const app = path.join(dir, 'apps', 'mercato'); fs.mkdirSync(app, { recursive: true })
    const file = path.join(app, '.env'); const before = 'DATABASE_URL=postgres://fixture@localhost/app\n'
    fs.writeFileSync(file, before)
    const commands = []
    await assert.rejects(databaseStep.apply({
      repoRoot: dir, env: {}, flags: {}, log() {},
      assertDatabaseWriteAllowedImpl: async () => ({ connectionEnv: {} }),
      assertEncryptionCompatibleImpl: () => assertEncryptionCompatible({ projectDir: app, env: {}, runProbe: async () => 'rejected' }),
      runStreamingImpl(...args) { commands.push(args) },
    }), /writes are blocked/)
    assert.deepEqual(commands, [])
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    assert.deepEqual(fs.readdirSync(dir), ['apps'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('all consumers ship the same preflight implementation and invoke it at the existing write boundary', () => {
  const source = fs.readFileSync(new URL('../encryption-preflight.mjs', import.meta.url))
  for (const file of ['../../../../scripts/dev-encryption-preflight.mjs', '../../../create-app/template/scripts/dev-encryption-preflight.mjs']) {
    assert.deepEqual(source, fs.readFileSync(new URL(file, import.meta.url)))
  }
  for (const file of ['../../../../scripts/dev.mjs', '../../../create-app/template/scripts/dev.mjs']) {
    const script = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const boundary = script.slice(script.indexOf('async function guardDatabaseMutation'), script.indexOf('async function applyDatabaseNameOverrideIfRequested'))
    assert.ok(boundary.indexOf('assertEncryptionCompatible') > boundary.indexOf('assertDatabaseWriteAllowed'))
  }
})


test('environment convergence never generates an encryption fallback for reused Vault or alternate-key configuration', async () => {
  const { envFilesStep } = await import('../steps.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-encryption-env-'))
  try {
    const app = path.join(dir, 'apps', 'mercato'); fs.mkdirSync(app, { recursive: true })
    const before = 'VAULT_ADDR=http://vault.fixture\nVAULT_TOKEN=fixture-token\nTENANT_DATA_ENCRYPTION_KEY=existing-fixture-key\n'
    fs.writeFileSync(path.join(dir, '.env'), before)
    fs.writeFileSync(path.join(app, '.env'), before)
    await envFilesStep.apply({ repoRoot: dir, company: { env: {} }, log() {} })
    for (const file of [path.join(dir, '.env'), path.join(app, '.env')]) {
      const after = fs.readFileSync(file, 'utf8')
      assert.ok(after.startsWith(before))
      assert.ok(!after.includes('TENANT_DATA_ENCRYPTION_FALLBACK_KEY'))
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
