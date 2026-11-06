import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { parseEnv } from 'node:util'

const FAILURE = '[setup] Encryption compatibility could not be verified; database writes are blocked. Restore the original TENANT_DATA_ENCRYPTION settings and encryption keys, and check Vault/KMS access (including historical tenant keys and FORMS_ENCRYPTION_MASTER_KEY). Do not regenerate keys or reinstall this database. Inspect permissions and unsupported encrypted stores with your administrator, or select a separate empty database. No preflight database or KMS writes were performed.'
const MAX_ROWS = 100_000
const MAX_BYTES = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000

function requireFrom(projectDir) {
  return createRequire(path.join(projectDir, 'package.json'))
}

async function importFrom(projectDir, name) {
  return import(pathToFileURL(requireFrom(projectDir).resolve(name)).href)
}

function settingsFor(projectDir, envFiles, env) {
  const settings = {}
  for (const file of [...envFiles, path.join(projectDir, '.env')]) {
    try { Object.assign(settings, parseEnv(fs.readFileSync(file, 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(FAILURE) }
  }
  return { ...settings, ...env }
}

export async function assertEncryptionCompatible({ projectDir = process.cwd(), envFiles = [], env = process.env, runProbe = runIsolatedProbe } = {}) {
  const settings = settingsFor(projectDir, envFiles, env)
  try {
    const status = await runProbe(projectDir, settings)
    if (!['empty', 'plaintext-only', 'verified'].includes(status)) throw new Error(FAILURE)
    return { status, settings }
  } catch { throw new Error(FAILURE) }
}

function runIsolatedProbe(projectDir, settings) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--encryption-probe', projectDir], {
      cwd: projectDir,
      env: { ...settings, TENANT_DATA_ENCRYPTION_DEBUG: 'off', OM_LOG_DESTINATION: 'stderr', OM_LOG_LEVEL: 'error' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    let status
    const timer = setTimeout(() => { child.kill('SIGKILL') }, TIMEOUT_MS)
    child.on('message', message => { if (typeof message === 'string') status = message })
    child.once('error', () => { clearTimeout(timer); reject(new Error(FAILURE)) })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0 && status) resolve(status)
      else reject(new Error(FAILURE))
    })
  })
}

function quote(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function byteBuffer(value) {
  if (typeof value !== 'string' || !/^\\x(?:[0-9a-f]{2})+$/i.test(value)) throw new Error(FAILURE)
  return Buffer.from(value.slice(2), 'hex')
}

export async function inspectEncryptionCompatibility({ client, kms, decrypt, resolveKeyId, loadForms, encryptionEnabled = true, maxRows = MAX_ROWS, maxBytes = MAX_BYTES }) {
  let rowsRead = 0
  let bytesRead = 0
  let ciphertexts = 0
  let applicationRows = 0
  const scopes = new Set()
  const keys = new Map()
  let forms
  const getForms = async () => forms ??= await loadForms()
  const inspectValue = async (value, keyId, depth = 0) => {
    if (depth > 32) throw new Error(FAILURE)
    if (typeof value === 'string') {
      if (/^\\x[0-9a-f]+$/i.test(value)) throw new Error(FAILURE)
      const envelopeParts = value.split(':')
      if (envelopeParts.length === 4 && /^v\d+$/.test(envelopeParts[3])) {
        if (!encryptionEnabled || !keyId) throw new Error(FAILURE)
        let dek = keys.get(keyId)
        if (!dek) {
          dek = await kms.getTenantDek(keyId)
          if (!dek) throw new Error(FAILURE)
          keys.set(keyId, dek)
        }
        const plaintext = decrypt(value, dek.key)
        if (plaintext === null) throw new Error(FAILURE)
        ciphertexts += 1
        await inspectValue(plaintext, keyId, depth + 1)
      } else if (/^\s*[\[{]/.test(value)) {
        let parsed
        try { parsed = JSON.parse(value) } catch { return }
        await inspectValue(parsed, keyId, depth + 1)
      }
    } else if (Array.isArray(value)) {
      for (const item of value) await inspectValue(item, keyId, depth + 1)
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) await inspectValue(item, keyId, depth + 1)
    }
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    await client.query("SET LOCAL statement_timeout = '10s'")
    await client.query('SET LOCAL row_security = off')
    const { rows: tables } = await client.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
      c.relrowsecurity AS rls, a.attname AS column, t.typname AS type
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_type t ON t.oid = a.atttypid
      WHERE c.relkind IN ('r', 'p', 'm', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
      ORDER BY n.nspname, c.relname, a.attnum`)
    const inventory = new Map()
    for (const column of tables) {
      if (column.rls || column.kind === 'f') throw new Error(FAILURE)
      const id = `${quote(column.schema)}.${quote(column.name)}`
      if (!inventory.has(id)) inventory.set(id, { ...column, binary: [] })
      if (column.type === 'bytea') inventory.get(id).binary.push(column.column)
    }
    for (const [table, metadata] of inventory) {
      await client.query(`DECLARE encryption_preflight NO SCROLL CURSOR FOR SELECT to_jsonb(record) AS record FROM ${table} record`)
      try {
        while (true) {
          const { rows } = await client.query('FETCH FORWARD 100 FROM encryption_preflight')
          if (rows.length === 0) break
          for (const { record } of rows) {
            rowsRead += 1
            bytesRead += Buffer.byteLength(JSON.stringify(record))
            if (rowsRead > maxRows || bytesRead > maxBytes) throw new Error(FAILURE)
            const keyId = metadata.name === 'onboarding_requests'
              ? resolveKeyId('onboarding:onboarding_request', 'system', record.tenant_id)
              : record.tenant_id
            if (!metadata.name.startsWith('mikro_orm_migrations')) {
              applicationRows += 1
              if (keyId) scopes.add(keyId)
            }
            for (const column of metadata.binary) {
              const value = record[column]
              if (value === null) continue
              const adapter = await getForms()
              if (metadata.name === 'forms_encryption_key' && column === 'wrapped_dek') {
                await adapter.unwrap(byteBuffer(value))
              } else if ((metadata.name === 'forms_form_submission_revision' && column === 'data')
                || (metadata.name === 'forms_form_attachment' && column === 'payload_inline')) {
                await adapter.decrypt(record.organization_id, byteBuffer(value))
              } else throw new Error(FAILURE)
              ciphertexts += 1
              delete record[column]
            }
            await inspectValue(record, keyId)
          }
        }
      } finally { await client.query('CLOSE encryption_preflight') }
    }
    if (applicationRows && encryptionEnabled) {
      if (scopes.size === 0 && !ciphertexts) throw new Error(FAILURE)
      for (const scope of scopes) {
        if (!keys.has(scope) && !await kms.getTenantDek(scope)) throw new Error(FAILURE)
      }
    }
    return ciphertexts ? 'verified' : applicationRows ? 'plaintext-only' : 'empty'
  } finally { await client.query('ROLLBACK') }
}

async function probe(projectDir) {
  const { Client } = createRequire(requireFrom(projectDir).resolve('@open-mercato/cli'))('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 15_000 })
  client.on('error', () => {})
  try {
    try { await client.connect() }
    catch (error) { if (error.code === '3D000') return 'empty'; throw error }
    const { createKmsService } = await importFrom(projectDir, '@open-mercato/shared/lib/encryption/kms')
    const { decryptWithAesGcm } = await importFrom(projectDir, '@open-mercato/shared/lib/encryption/aes')
    const { resolveEncryptionKeyId } = await importFrom(projectDir, '@open-mercato/shared/lib/encryption/tenantDataEncryptionService')
    const { isTenantDataEncryptionEnabled } = await importFrom(projectDir, '@open-mercato/shared/lib/encryption/toggles')
    return await inspectEncryptionCompatibility({
      encryptionEnabled: isTenantDataEncryptionEnabled(),
      client, kms: createKmsService(), decrypt: decryptWithAesGcm, resolveKeyId: resolveEncryptionKeyId,
      loadForms: async () => {
        const { resolveKmsAdapter, FormsEncryptionService } = await importFrom(projectDir, '@open-mercato/core/modules/forms/services/encryption-service')
        const adapter = resolveKmsAdapter(process.env)
        const service = new FormsEncryptionService({ kmsAdapter: adapter, emFactory: () => ({
          findOne: async (_entity, { organizationId, keyVersion }) => {
            const { rows } = await client.query('SELECT wrapped_dek FROM forms_encryption_key WHERE organization_id = $1 AND key_version = $2', [organizationId, keyVersion])
            return rows[0] ? { wrappedDek: rows[0].wrapped_dek } : null
          },
        }) })
        return { unwrap: value => adapter.unwrap(value), decrypt: (organizationId, value) => service.decrypt(organizationId, value) }
      },
    })
  } finally { await client.end() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--encryption-probe') {
  try {
    const status = await probe(process.argv[3])
    await new Promise((resolve, reject) => process.send(status, error => error ? reject(error) : resolve()))
    process.exit(0)
  }
  catch { process.exit(1) }
}


export async function runEncryptionGuardedSetupCommand(command, { projectDir = process.cwd(), verify = assertEncryptionCompatible, spawnCommand = spawn } = {}) {
  const compatibility = await verify({ projectDir })
  const child = spawnCommand('sh', ['-lc', command], { cwd: projectDir, env: compatibility.settings, stdio: 'inherit' })
  const interrupt = () => child.kill('SIGINT')
  const terminate = () => child.kill('SIGTERM')
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error(FAILURE)))
      child.once('exit', code => resolve(code ?? 1))
    })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--run-setup-command') {
  try { process.exit(await runEncryptionGuardedSetupCommand(process.argv[3])) }
  catch { console.error(FAILURE); process.exit(78) }
}
