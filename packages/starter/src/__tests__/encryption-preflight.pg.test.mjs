import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { GenericContainer, Wait } from 'testcontainers'
import pg from 'pg'
import { assertEncryptionCompatible } from '../encryption-preflight.mjs'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { EnvMasterKeyKmsAdapter, FormsEncryptionService } from '@open-mercato/core/modules/forms/services/encryption-service'

const repository = fileURLToPath(new URL('../../../..', import.meta.url))
const tenant = '00000000-0000-4000-8000-000000000001'
const organization = '00000000-0000-4000-8000-000000000002'

test('disposable PostgreSQL: actual isolated helpers prove keys and rejected reuse never changes stored bytes', { skip: process.env.OM_PG_INTEGRATION !== '1', timeout: 180_000 }, async () => {
  const container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'disposable-fixture', POSTGRES_DB: 'fixture' })
    .withExposedPorts({ container: 5432, host: 0 })
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .withStartupTimeout(60_000).start()
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-preflight-standalone-'))
  const originalEnv = { ...process.env }
  let client
  let vault
  try {
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{"private":true,"type":"module"}')
    fs.symlinkSync(path.join(repository, 'node_modules'), path.join(projectDir, 'node_modules'), 'dir')
    const url = `postgres://postgres:disposable-fixture@${container.getHost()}:${container.getMappedPort(5432)}/fixture`
    const env = { ...process.env, DATABASE_URL: url, TENANT_DATA_ENCRYPTION: 'yes', TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'original-fixture-key', TENANT_DATA_ENCRYPTION_KEY: '', ALLOW_DERIVED_KMS_FALLBACK: 'false', VAULT_ADDR: '', VAULT_TOKEN: '', NODE_ENV: 'production' }
    const run = (changes = {}, project = projectDir) => assertEncryptionCompatible({ projectDir: project, env: { ...env, ...changes } })
    client = new pg.Client({ connectionString: url }); await client.connect()
    assert.equal((await run()).status, 'empty')
    await client.query('CREATE TABLE mikro_orm_migrations_fixture (name text)')
    await client.query("INSERT INTO mikro_orm_migrations_fixture VALUES ('new-migration')")
    assert.equal((await run()).status, 'empty')
    await client.query('CREATE TABLE protected_fixture (tenant_id uuid, value text, doc jsonb)')
    assert.equal((await run()).status, 'empty')
    await client.query('INSERT INTO protected_fixture VALUES ($1, $2, $3)', [tenant, 'plaintext', '{}'])
    assert.equal((await run()).status, 'plaintext-only')
    await assert.rejects(run({ TENANT_DATA_ENCRYPTION_FALLBACK_KEY: '' }), /writes are blocked/)
    await assert.rejects(run({ TENANT_DATA_ENCRYPTION_FALLBACK_KEY: '', VAULT_ADDR: 'http://127.0.0.1:1', VAULT_TOKEN: 'unavailable-fixture-token' }), /writes are blocked/)
    assert.equal((await run({ TENANT_DATA_ENCRYPTION: 'off', TENANT_DATA_ENCRYPTION_FALLBACK_KEY: '' })).status, 'plaintext-only')
    process.env = { ...env }
    const kms = createKmsService()
    const dek = await kms.getTenantDek(tenant)
    const sealed = encryptWithAesGcm('private-existing-data', dek.key).raw
    const nested = encryptWithAesGcm(JSON.stringify({ inner: sealed }), dek.key).raw
    await client.query('UPDATE protected_fixture SET value = $1, doc = $2', [sealed, JSON.stringify({ nested: [nested] })])
    const before = (await client.query('SELECT row_to_json(record) AS record FROM protected_fixture record')).rows
    assert.equal((await run()).status, 'verified')
    assert.equal((await run({}, path.join(repository, 'apps', 'mercato'))).status, 'verified')
    await client.query('CREATE TABLE document_contents (tenant_id uuid, yjs_state bytea, content_text text)')
    await client.query('CREATE TABLE document_versions (tenant_id uuid, yjs_snapshot bytea)')
    await client.query('INSERT INTO document_contents VALUES ($1, $2, $3)', [tenant, Buffer.from([1, 2, 3]), 'urn:om:sku:v2'])
    await client.query('INSERT INTO document_versions VALUES ($1, $2)', [tenant, Buffer.from([4, 5, 6])])
    assert.equal((await run()).status, 'verified')
    await client.query('UPDATE document_contents SET content_text = $1', [sealed])
    assert.equal((await run()).status, 'verified')
    await client.query('CREATE TABLE audit_fixture (tenant_id uuid, message text, protected_value text)')
    await client.query("INSERT INTO audit_fixture SELECT $1::uuid, repeat('audit', 150), NULL::text FROM generate_series(1, 150000)", [tenant])
    assert.equal((await run()).status, 'verified')
    await client.query('UPDATE audit_fixture SET protected_value = $1', [sealed])
    assert.equal((await run()).status, 'verified')
    await client.query('DROP TABLE audit_fixture')

    for (const changes of [
      { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'wrong-fixture-key' },
      { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: '' },
      { TENANT_DATA_ENCRYPTION: 'off' },
      { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: '', VAULT_ADDR: 'http://127.0.0.1:1', VAULT_TOKEN: 'unavailable-fixture-token' },
    ]) await assert.rejects(run(changes), /writes are blocked/)
    const requests = []
    let vaultStatus = 200
    vault = createServer((request, response) => {
      requests.push(request.method)
      response.writeHead(vaultStatus, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: { data: vaultStatus === 200 ? { key: dek.key } : {} } }))
    })
    await new Promise(resolve => vault.listen(0, '127.0.0.1', resolve))
    const vaultEnv = { TENANT_DATA_ENCRYPTION_FALLBACK_KEY: '', VAULT_ADDR: `http://127.0.0.1:${vault.address().port}`, VAULT_TOKEN: 'read-only-fixture-token' }
    assert.equal((await run(vaultEnv)).status, 'verified')
    for (const status of [403, 404, 503]) {
      vaultStatus = status
      await assert.rejects(run(vaultEnv), /writes are blocked/)
    }
    assert.ok(requests.length >= 4)
    assert.ok(requests.every(method => method === 'GET'))
    assert.deepEqual((await client.query('SELECT row_to_json(record) AS record FROM protected_fixture record')).rows, before)
    await client.query('CREATE TABLE onboarding_requests (tenant_id uuid, email text)')
    const systemDek = await kms.getTenantDek('system:onboarding:onboarding_request')
    await client.query('INSERT INTO onboarding_requests VALUES ($1, $2)', [tenant, encryptWithAesGcm('system-existing-data', systemDek.key).raw])
    assert.equal((await run()).status, 'verified')
    await client.query('CREATE TABLE forms_encryption_key (organization_id uuid, key_version int, wrapped_dek bytea)')
    await client.query('CREATE TABLE forms_form_submission_revision (organization_id uuid, data bytea)')
    const masterKey = Buffer.alloc(32, 8)
    const formsDek = Buffer.alloc(32, 9)
    const adapter = new EnvMasterKeyKmsAdapter(masterKey)
    const wrappedDek = await adapter.wrap(formsDek)
    await client.query('INSERT INTO forms_encryption_key VALUES ($1, 1, $2)', [organization, wrappedDek])
    const forms = new FormsEncryptionService({ kmsAdapter: adapter, emFactory: () => ({ findOne: async () => ({ keyVersion: 1, wrappedDek }) }) })
    const encrypted = await forms.encrypt(organization, Buffer.from('existing-revision'))
    await client.query('INSERT INTO forms_form_submission_revision VALUES ($1, $2)', [organization, encrypted])
    const formsEnv = { FORMS_ENCRYPTION_MASTER_KEY: masterKey.toString('base64') }
    assert.equal((await run(formsEnv)).status, 'verified')
    await assert.rejects(run({ FORMS_ENCRYPTION_MASTER_KEY: Buffer.alloc(32, 7).toString('base64') }), /writes are blocked/)
    await assert.rejects(run({ FORMS_ENCRYPTION_MASTER_KEY: '', FORMS_ENCRYPTION_KMS_KEY_ID: '' }), /writes are blocked/)
    const stored = (await client.query('SELECT data FROM forms_form_submission_revision')).rows[0].data
    assert.deepEqual(stored, encrypted)
    const envBefore = 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=wrong-fixture-key\n'
    fs.writeFileSync(path.join(projectDir, '.env'), envBefore)
    await assert.rejects(run({ TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'wrong-fixture-key' }), /writes are blocked/)
    assert.equal(fs.readFileSync(path.join(projectDir, '.env'), 'utf8'), envBefore)
    const { databaseStep } = await import('../steps.mjs')
    const appDir = path.join(projectDir, 'apps', 'mercato')
    fs.mkdirSync(appDir, { recursive: true })
    const appEnv = `DATABASE_URL=${url}\nTENANT_DATA_ENCRYPTION_FALLBACK_KEY=wrong-fixture-key\n`
    fs.writeFileSync(path.join(appDir, '.env'), appEnv)
    const mutations = []
    await assert.rejects(databaseStep.apply({
      repoRoot: projectDir, env: { ...env, TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'wrong-fixture-key' }, flags: {}, log() {},
      runStreamingImpl(...args) { mutations.push(args); throw new Error('mutation must not launch') },
    }), /writes are blocked/)
    assert.deepEqual(mutations, [])
    const guardMarker = path.join(projectDir, 'guarded-mutation')
    const command = `node -e 'require("node:fs").writeFileSync(process.env.TEST_GUARD_MARKER,"ran")'`
    const containerRun = spawnSync('sh', [path.join(repository, 'docker', 'scripts', 'init-or-migrate.sh')], {
      cwd: appDir,
      env: { ...env, TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'wrong-fixture-key', INIT_MARKER_FILE: path.join(projectDir, 'seed-marker'), INIT_COMMAND: command, MIGRATE_COMMAND: command, SYNC_ROLE_ACLS_COMMAND: command, TEST_GUARD_MARKER: guardMarker },
      encoding: 'utf8', timeout: 30_000,
    })
    assert.notEqual(containerRun.status, 0)
    assert.match(containerRun.stdout, /writes are blocked/)
    assert.equal(fs.existsSync(guardMarker), false)
    assert.equal(fs.existsSync(path.join(projectDir, 'seed-marker')), false)
    const imageScripts = path.join(projectDir, 'docker', 'scripts')
    fs.mkdirSync(imageScripts, { recursive: true })
    fs.copyFileSync(path.join(repository, 'docker', 'scripts', 'init-or-migrate.sh'), path.join(imageScripts, 'init-or-migrate.sh'))
    fs.copyFileSync(path.join(repository, 'packages', 'starter', 'src', 'encryption-preflight.mjs'), path.join(imageScripts, 'encryption-preflight.mjs'))
    const acceptedContainer = spawnSync('sh', [path.join(imageScripts, 'init-or-migrate.sh')], {
      cwd: appDir,
      env: { ...env, ...formsEnv, INIT_MARKER_FILE: path.join(projectDir, 'seed-marker'), INIT_COMMAND: command, MIGRATE_COMMAND: command, SYNC_ROLE_ACLS_COMMAND: command, TEST_GUARD_MARKER: guardMarker },
      encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(acceptedContainer.status, 0, acceptedContainer.stdout + acceptedContainer.stderr)
    assert.equal(fs.readFileSync(guardMarker, 'utf8'), 'ran')
    assert.equal(fs.existsSync(path.join(projectDir, 'seed-marker')), true)


    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), appEnv)
    assert.deepEqual((await client.query('SELECT data FROM forms_form_submission_revision')).rows[0].data, encrypted)

    assert.equal((await run({ DATABASE_URL: url.replace(/fixture$/, 'missing_fixture') })).status, 'empty')
  } finally {
    process.env = originalEnv
    if (vault) await new Promise(resolve => vault.close(resolve))
    if (client) await client.end()
    fs.rmSync(projectDir, { recursive: true, force: true })
    await container.stop()
  }
})
