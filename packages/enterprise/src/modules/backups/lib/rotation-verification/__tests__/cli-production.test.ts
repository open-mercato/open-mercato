/** @jest-environment node */
import { createContainer, asValue, type AwilixContainer } from 'awilix'
import { EntitySchema } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptionMap, CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { createDerivedKeyKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { encryptWithAesGcm, decryptWithAesGcm, hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { generateX25519Identity, identityToRecipient } from '../../engine/crypto'
import { register } from '../../../di'

let mockContainer: AwilixContainer
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/di/container'),
  createRequestContainer: async () => mockContainer,
}))

class CliFixtureRecord {
  id!: string
  tenantId!: string
  organizationId!: string
  secret!: string
  secretHash?: string | null
  untouched?: unknown
}
const recordSchema = new EntitySchema({
  class: CliFixtureRecord,
  tableName: 'cli_fixture_records',
  properties: {
    id: { type: 'uuid', primary: true },
    tenantId: { type: 'uuid', fieldName: 'tenant_id' },
    organizationId: { type: 'uuid', fieldName: 'organization_id' },
    secret: { type: 'text' },
    secretHash: { type: 'text', fieldName: 'secret_hash', nullable: true },
    untouched: { type: 'jsonb', nullable: true },
  },
})
const native = process.env.OM_ROTATION_TEST_DATABASE_URL ? describe : describe.skip
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const sourceSecret = 'isolated-cli-previous-root'
const targetSecret = 'isolated-cli-target-root'

native('real Core CLI handler with Enterprise DI and native PostgreSQL', () => {
  let orm: MikroORM
  let database: string
  let directory: string
  let base: URL
  let previousEnvironment: NodeJS.ProcessEnv
  let stderrDescriptors: Record<string, PropertyDescriptor | undefined>
  beforeEach(async () => {
    previousEnvironment = { ...process.env }
    stderrDescriptors = Object.fromEntries(['isTTY', 'columns', 'rows'].map(key => [key, Object.getOwnPropertyDescriptor(process.stderr, key)]))
    directory = await mkdtemp(join(tmpdir(), 'rotation-cli-production-'))
    base = new URL(process.env.OM_ROTATION_TEST_DATABASE_URL!)
    database = 'rotation_cli_' + randomUUID().replaceAll('-', '')
    const administrator = new Client({ connectionString: base.toString() })
    await administrator.connect()
    try {
      await administrator.query('CREATE DATABASE "' + database + '" CONNECTION LIMIT 0')
      await administrator.query('ALTER DATABASE "' + database + '" SET statement_timeout = 900000')
      await administrator.query('ALTER DATABASE "' + database + '" SET lock_timeout = 30000')
    } finally { await administrator.end() }
    base.pathname = '/' + database
    orm = await MikroORM.init({ clientUrl: base.toString(), entities: [recordSchema, EncryptionMap, CustomFieldDef], pool: { min: 0, max: 1 } })
    await orm.schema.create()
    registerEntityIds({ fixture: { CliFixtureRecord: 'test:cli_record' } })
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    for (const [key, descriptor] of Object.entries(stderrDescriptors)) {
      if (descriptor) Object.defineProperty(process.stderr, key, descriptor)
      else Reflect.deleteProperty(process.stderr, key)
    }
    await mockContainer?.dispose()
    await orm?.close(true)
    const administrator = new Client({ connectionString: previousEnvironment.OM_ROTATION_TEST_DATABASE_URL! })
    await administrator.connect()
    try { await administrator.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)') } finally { await administrator.end() }
    process.env = previousEnvironment
    await rm(directory, { recursive: true, force: true })
  })
  async function runtimeEnvironment(): Promise<NodeJS.ProcessEnv> {
    const bin = join(directory, 'bin'); await mkdir(bin, { mode: 0o700 })
    const serviceFile = join(directory, 'service.conf'); const containerFile = join(directory, 'container.conf'); const passwordFile = join(directory, 'password')
    const service = (port: string) => `[source]\nhost=127.0.0.1\nport=${port}\ndbname=${database}\nuser=postgres\nsslmode=disable\n`
    await writeFile(serviceFile, service(base.port), { mode: 0o600 }); await writeFile(containerFile, service('5432'), { mode: 0o600 })
    await writeFile(passwordFile, `*:*:*:postgres:${base.password}\n`, { mode: 0o600 })
    const docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim()
    const container = process.env.OM_ROTATION_TEST_CONTAINER ?? 'om-pg-9334-fixture'
    if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('Invalid isolated container')
    execFileSync(docker, ['exec', container, 'mkdir', '-p', directory])
    execFileSync(docker, ['cp', containerFile, `${container}:${containerFile}`])
    execFileSync(docker, ['cp', passwordFile, `${container}:${passwordFile}`])
    for (const name of ['pg_dump', 'pg_restore', 'psql']) await writeFile(join(bin, name), `#!/bin/sh\nexec '${docker}' exec -i -e PGSERVICEFILE='${containerFile}' -e PGPASSFILE='${passwordFile}' '${container}' ${name} "$@"\n`, { mode: 0o700 })
    await writeFile(join(bin, 'pg_restore'), `#!/bin/sh\nif [ "$1" = "--list" ]; then\n  exec '${docker}' exec -i '${container}' pg_restore --list < "$2"\nfi\nfor file in "$@"; do\n  if [ -f "$file" ]; then\n    '${docker}' exec '${container}' mkdir -p "$(/usr/bin/dirname "$file")"\n    '${docker}' cp "$file" '${container}':"$file"\n  fi\ndone\nexec '${docker}' exec -i -e PGSERVICEFILE='${containerFile}' -e PGPASSFILE='${passwordFile}' '${container}' pg_restore "$@"\n`, { mode: 0o700 })
    const identity = await generateX25519Identity(); const recipient = await identityToRecipient(identity)
    const recipientsFile = join(directory, 'recipients'); const identitiesFile = join(directory, 'identities')
    await writeFile(recipientsFile, recipient+'\n', { mode: 0o600 }); await writeFile(identitiesFile, identity+'\n', { mode: 0o600 })
    return {
      OM_ENABLE_ENTERPRISE_MODULES: 'true', OM_ENABLE_ENTERPRISE_MODULES_BACKUPS: 'true', OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED: 'true',
      OM_ROTATION_KMS_PROVIDER: 'derived', TENANT_DATA_ENCRYPTION_KEY: targetSecret,
      OM_ROTATION_RECIPIENTS_FILE: recipientsFile, OM_ROTATION_IDENTITIES_FILE: identitiesFile,
      OM_ROTATION_ARTIFACT_ROOT: join(directory, 'rotation-artifacts'), OM_ROTATION_TRUST_ROOT: join(directory, 'rotation-trust'),
      OM_ROTATION_BACKUP_OUTPUT: join(directory, 'backups'), OM_ROTATION_BACKUP_WORKSPACE: join(directory, 'workspace'),
      OM_ROTATION_BACKUP_SOURCE_SERVICE: 'source', OM_BACKUP_BINARIES_DIR: bin, PGSERVICEFILE: serviceFile, PGPASSFILE: passwordFile,
    }
  }
  test('actual handler selects registered protection, backs up, rotates mapped and custom rows, then verifies persisted data', async () => {
    const stdout: string[] = []; const stderr: string[] = []
    const log = jest.spyOn(console, 'log').mockImplementation((...values) => { stdout.push(values.map(String).join(' ')) })
    const error = jest.spyOn(console, 'error').mockImplementation((...values) => { stderr.push(values.map(String).join(' ') + '\n') })
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(chunk => { stderr.push(String(chunk)); return true })
    const source = (await createDerivedKeyKmsService(sourceSecret).getTenantDek(tenantId))!.key
    const target = (await createDerivedKeyKmsService(targetSecret).getTenantDek(tenantId))!.key
    const em = orm.em.fork()
    await em.execute('CREATE TABLE custom_entities_storage(id uuid PRIMARY KEY,entity_type text,tenant_id uuid,organization_id uuid,doc jsonb,updated_at timestamptz NOT NULL)')
    const recordId = randomUUID()
    await em.execute('INSERT INTO cli_fixture_records VALUES(?,?,?,?,?,?::jsonb)', [recordId, tenantId, organizationId, encryptWithAesGcm('mapped-private-東京', source).value, hashForLookup('mapped-private-東京'), JSON.stringify({ preserved: [null, true, 'untouched'] })])
    const customId = randomUUID()
    await em.execute('INSERT INTO custom_entities_storage VALUES(?,?,?,?,?::jsonb,?::timestamptz)', [customId, 'test:cli_dynamic', tenantId, organizationId, JSON.stringify({ secret: encryptWithAesGcm('custom-private-東京', source).value, preserved: { value: true } }), '2026-01-02 03:04:05.123456+00'])
    em.persist(em.create(EncryptionMap, { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), entityId: 'test:cli_record', tenantId, organizationId, fieldsJson: [{ field: 'secret', hashField: 'secretHash' }], isActive: true }))
    em.persist(em.create(CustomFieldDef, { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), entityId: 'test:cli_dynamic', tenantId, organizationId, key: 'secret', kind: 'text', configJson: { encrypted: true }, isActive: true }))
    await em.flush()
    Object.assign(process.env, await runtimeEnvironment(), { TENANT_DATA_ENCRYPTION: 'yes', TENANT_DATA_ENCRYPTION_OLD_KEY: sourceSecret, TENANT_DATA_ENCRYPTION_KEY: targetSecret, OM_ROTATION_PROGRESS: 'none' })
    const outputMode = process.env.OM_ROTATION_CLI_EVIDENCE_MODE
    if (outputMode === 'tty') {
      for (const [key, value] of Object.entries({ isTTY: true, columns: 100, rows: 30 })) Object.defineProperty(process.stderr, key, { configurable: true, value })
      delete process.env.NO_COLOR
      process.env.TERM = 'xterm-256color'
      process.env.OM_ROTATION_PROGRESS = ''
    } else if (outputMode === 'json') process.env.OM_ROTATION_PROGRESS = 'json'
    delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
    mockContainer = createContainer()
    mockContainer.register({ em: asValue(em) })
    register(mockContainer)
    expect(mockContainer.hasRegistration('rotationProtectionService')).toBe(true)
    const cli = require('@open-mercato/core/modules/entities/cli').default as Array<{ command: string; run(args: string[]): Promise<void> }>
    const handler = cli.find(command => command.command === 'rotate-encryption-key')!
    await handler.run(['--tenant', tenantId, '--org', organizationId])
    const mapped = (await em.execute('SELECT secret,secret_hash,untouched FROM cli_fixture_records WHERE id=?', [recordId]))[0]
    expect(decryptWithAesGcm(mapped.secret, target)).toBe('mapped-private-東京')
    expect(decryptWithAesGcm(mapped.secret, source)).toBeNull()
    expect(mapped.secret_hash).toBe(hashForLookup('mapped-private-東京'))
    expect(mapped.untouched).toEqual({ preserved: [null, true, 'untouched'] })
    const custom = (await em.execute('SELECT doc FROM custom_entities_storage WHERE id=?', [customId]))[0].doc
    expect(decryptWithAesGcm(custom.secret, target)).toBe('custom-private-東京')
    expect(custom.preserved).toEqual({ value: true })
    const trust = process.env.OM_ROTATION_TRUST_ROOT!
    const files = await readdir(trust)
    const reports = files.filter(name => name.endsWith('.report.json'))
    expect(reports).toHaveLength(1)
    const result = JSON.parse(await readFile(join(trust, reports[0]!), 'utf8'))
    expect(result).toMatchObject({ status: 'passed', expectedRows: '2', comparedRows: '2' })
    expect(result.expectedBytes).toBe(result.comparedBytes)
    expect((await stat(result.recoveryArtifact)).isDirectory()).toBe(true)
    const manifest = JSON.parse(await readFile(join(result.recoveryArtifact, 'manifest.json'), 'utf8'))
    expect(manifest.encryption.mode).toBe('age-v1')
    expect(files).not.toContain('rotation.lock')
    expect(files.some(name => /[.]failure[.].+[.]json$/.test(name))).toBe(false)
    expect(stdout.some(line => line.startsWith('{"schemaVersion"'))).toBe(false)
    expect(stderr.some(line => line.includes('Persisted data verification passed'))).toBe(true)
    if (process.env.OM_ROTATION_CLI_EVIDENCE_OUT) await writeFile(process.env.OM_ROTATION_CLI_EVIDENCE_OUT, JSON.stringify({
      schemaVersion: 1, scope: 'Actual Core CLI handler, real MikroORM, actual Enterprise DI registration; app container factory is the only mocked integration boundary',
      fixture: 'Two generated rows, mapped scalar and custom JSON, synthetic tenant/organization',
      stdout, stderr, receipt: result,
      terminal: outputMode === 'tty' ? 'Harness advertises a 100x30 stderr TTY; actual production ANSI output captured verbatim' : outputMode === 'json' ? 'Actual production NDJSON stderr captured verbatim' : 'No live progress; actual production final guidance captured',
      assertions: ['mapped ciphertext opens only with target key', 'custom ciphertext opens with target key', 'lookup hash preserves framework contract', 'untouched columns remain equal', 'complete persisted verification covers both rows', 'Core stdout gains no structured JSON result', 'encrypted recovery artifact remains after verified pass', 'no failure receipt or stale lock'],
    }, null, 2), { mode: 0o600 })
    log.mockRestore(); error.mockRestore(); write.mockRestore()
  }, 60000)

  test('escaped unpaired Unicode in encrypted JSON refuses before any Core mutation', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const source = (await createDerivedKeyKmsService(sourceSecret).getTenantDek(tenantId))!.key
    const em = orm.em.fork()
    const recordId = randomUUID()
    const original = encryptWithAesGcm(JSON.stringify({ text: String.fromCharCode(0xd800) }), source).value
    await em.execute('INSERT INTO cli_fixture_records VALUES(?,?,?,?,NULL,?::jsonb)', [recordId, tenantId, organizationId, original, '{}'])
    em.persist(em.create(EncryptionMap, { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), entityId: 'test:cli_record', tenantId, organizationId, fieldsJson: [{ field: 'secret' }], isActive: true }))
    await em.flush()
    Object.assign(process.env, await runtimeEnvironment(), { TENANT_DATA_ENCRYPTION: 'yes', TENANT_DATA_ENCRYPTION_OLD_KEY: sourceSecret, TENANT_DATA_ENCRYPTION_KEY: targetSecret, OM_ROTATION_PROGRESS: 'none' })
    delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
    mockContainer = createContainer()
    mockContainer.register({ em: asValue(em) }); register(mockContainer)
    const cli = require('@open-mercato/core/modules/entities/cli').default as Array<{ command: string; run(args: string[]): Promise<void> }>
    await expect(cli.find(command => command.command === 'rotate-encryption-key')!.run(['--tenant', tenantId, '--org', organizationId])).rejects.toThrow('ROTATION_COVERAGE_UNSUPPORTED')
    expect((await em.execute('SELECT secret FROM cli_fixture_records WHERE id=?', [recordId]))[0].secret).toBe(original)
    const files = await readdir(process.env.OM_ROTATION_TRUST_ROOT!)
    expect(files.filter(name => name.endsWith('.report.json'))).toEqual([])
    expect(files.some(name => /[.]failure[.].+[.]json$/.test(name))).toBe(true)
  }, 60000)

  test('protected default-schema Core mapping ignores a search-path shadow and verifies the public relation', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const source = (await createDerivedKeyKmsService(sourceSecret).getTenantDek(tenantId))!.key
    const target = (await createDerivedKeyKmsService(targetSecret).getTenantDek(tenantId))!.key
    const em = orm.em.fork()
    const recordId = randomUUID()
    const publicCiphertext = encryptWithAesGcm('public-already-target', target).value
    const shadowCiphertext = encryptWithAesGcm('shadow-must-stay-untouched', source).value
    const metadata = orm.getMetadata().get(CliFixtureRecord)
    expect(metadata.schema).toBeUndefined()
    await em.execute('INSERT INTO public.cli_fixture_records VALUES(?,?,?,?,NULL,?::jsonb)', [recordId, tenantId, organizationId, publicCiphertext, '{}'])
    await em.execute('CREATE SCHEMA rotation_shadow')
    await em.execute('CREATE TABLE rotation_shadow.cli_fixture_records (LIKE public.cli_fixture_records INCLUDING ALL)')
    await em.execute('INSERT INTO rotation_shadow.cli_fixture_records VALUES(?,?,?,?,NULL,?::jsonb)', [recordId, tenantId, organizationId, shadowCiphertext, '{}'])
    em.persist(em.create(EncryptionMap, { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), entityId: 'test:cli_record', tenantId, organizationId, fieldsJson: [{ field: 'secret' }], isActive: true }))
    await em.flush()
    await em.execute('SET search_path TO rotation_shadow, public')
    // Prove the same session would select the shadow without qualification.
    expect((await em.execute('SELECT secret FROM cli_fixture_records WHERE id=?', [recordId]))[0].secret).toBe(shadowCiphertext)
    Object.assign(process.env, await runtimeEnvironment(), { TENANT_DATA_ENCRYPTION: 'yes', TENANT_DATA_ENCRYPTION_OLD_KEY: sourceSecret, TENANT_DATA_ENCRYPTION_KEY: targetSecret, OM_ROTATION_PROGRESS: 'none' })
    delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
    mockContainer = createContainer()
    mockContainer.register({ em: asValue(em) }); register(mockContainer)
    const cli = require('@open-mercato/core/modules/entities/cli').default as Array<{ command: string; run(args: string[]): Promise<void> }>
    await cli.find(command => command.command === 'rotate-encryption-key')!.run(['--tenant', tenantId, '--org', organizationId])
    expect((await em.execute('SELECT secret FROM public.cli_fixture_records WHERE id=?', [recordId]))[0].secret).toBe(publicCiphertext)
    expect((await em.execute('SELECT secret FROM rotation_shadow.cli_fixture_records WHERE id=?', [recordId]))[0].secret).toBe(shadowCiphertext)
    const files = await readdir(process.env.OM_ROTATION_TRUST_ROOT!)
    const reports = files.filter(name => name.endsWith('.report.json'))
    expect(reports).toHaveLength(1)
    const report = JSON.parse(await readFile(join(process.env.OM_ROTATION_TRUST_ROOT!, reports[0]!), 'utf8'))
    expect(report).toMatchObject({ status: 'passed', expectedRows: '1', comparedRows: '1' })
    expect(files.some(name => /[.]failure[.].+[.]json$/.test(name))).toBe(false)
  }, 60000)

})
