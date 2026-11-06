import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { assertEncryptionCompatible, inspectEncryptionCompatibility, runEncryptionGuardedSetupCommand } from '../encryption-preflight.mjs'
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
    if (sql.includes('FROM pg_class')) {
      const base = { schema: 'public', name: options.table ?? 'fixture', kind: 'r', rls: false }
      return { rows: [{ ...base, column: 'value', type: 'text', ...options.metadata }, ...(records.some(record => record.tenant_id) ? [{ ...base, column: 'tenant_id', type: 'uuid' }] : [])] }
    }
    if (sql.startsWith('SELECT EXISTS')) return { rows: [{ populated: records.length > 0 }] }
    if (sql.startsWith('SELECT DISTINCT')) return { rows: [...new Set(records.map(record => record.tenant_id).filter(Boolean))].map(scope => ({ scope })) }
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
    fixture([{ tenant_id: tenant, value: 'AAAAAAAAAAAAAAAA:payload:tag:v1' }]),
    fixture([{ value: sealed }]),
    { ...fixture([{ tenant_id: tenant, value: sealed }]), maxRows: 0 },
    { ...fixture([{ tenant_id: tenant, value: sealed }]), maxBytes: 0 },
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


test('ordinary version-suffixed plaintext remains compatible before and after authenticated decryption', async () => {
  const plaintext = 'urn:om:sku:v2'
  assert.equal(await inspectEncryptionCompatibility(fixture([{ tenant_id: tenant, value: plaintext }])), 'plaintext-only')
  const encrypted = encryptWithAesGcm(plaintext, correct).raw
  assert.equal(await inspectEncryptionCompatibility(fixture([{ tenant_id: tenant, value: encrypted }])), 'verified')
})


test('container command wrapper freezes verified settings and never spawns on rejection', async () => {
  let spawned = false
  await assert.rejects(runEncryptionGuardedSetupCommand('fixture-command', {
    verify: async () => { throw new Error('rejected') },
    spawnCommand: () => { spawned = true; throw new Error('must not launch') },
  }), /rejected/)
  assert.equal(spawned, false)
  let received
  const result = await runEncryptionGuardedSetupCommand('fixture-command', {
    verify: async () => ({ settings: { DATABASE_URL: 'verified-fixture', TENANT_DATA_ENCRYPTION_KEY: 'verified-fixture-key' } }),
    spawnCommand: (command, args, options) => {
      received = { command, args, env: options.env }
      const child = new EventEmitter()
      child.kill = () => {}
      setImmediate(() => child.emit('exit', 7))
      return child
    },
  })
  assert.equal(result, 7)
  assert.equal(received.command, 'sh')
  assert.equal(received.env.DATABASE_URL, 'verified-fixture')
  assert.equal(received.env.TENANT_DATA_ENCRYPTION_KEY, 'verified-fixture-key')
})


test('brand-new environments receive unique encryption configuration shared by root and app', async () => {
  const { ensureEnvFiles } = await import('../env-setup.mjs')
  const directories = []
  const keys = []
  try {
    for (const index of [0, 1]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `om-fresh-encryption-${index}-`)); directories.push(dir)
      const app = path.join(dir, 'apps', 'mercato'); fs.mkdirSync(app, { recursive: true })
      fs.writeFileSync(path.join(app, '.env.example'), 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=public-fixture-placeholder\nJWT_SECRET=placeholder\n')
      ensureEnvFiles(dir, { log() {}, warn() {}, env: {} })
      const rootKey = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^TENANT_DATA_ENCRYPTION_FALLBACK_KEY=(.+)$/m)?.[1]
      assert.match(rootKey, /^[a-f0-9]{64}$/)
      assert.ok(fs.readFileSync(path.join(app, '.env'), 'utf8').includes(`TENANT_DATA_ENCRYPTION_FALLBACK_KEY=${rootKey}`))
      keys.push(rootKey)
    }
    assert.notEqual(keys[0], keys[1])
  } finally { for (const dir of directories) fs.rmSync(dir, { recursive: true, force: true }) }
})
