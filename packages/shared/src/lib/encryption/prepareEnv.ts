import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseEnv } from 'dotenv'
import { setTimeout as delay } from 'node:timers/promises'
import { parseBooleanToken } from '../boolean'
import { createLogger } from '../logger'

const keyNames = ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'TENANT_DATA_ENCRYPTION_KEY', 'LOOKUP_HASH_PEPPER'] as const
const publishedKeys = new Set(['dev-tenant-encryption-fallback-key-32chars', 'om-dev-tenant-encryption'])
const emittedWarnings = new Set<string>()

function warnOnce(message: string): void {
  if (emittedWarnings.has(message)) return
  emittedWarnings.add(message)
  createLogger('shared:encryption-startup').warn(message)
}

function rotationWarning(name: string, reason = 'uses a published development key'): string {
  return `${name} ${reason}. The configured key is unchanged. Before rotating, back up the database AND current env files/keys, verify restoration, and stop all writers. Securely provide the current root as TENANT_DATA_ENCRYPTION_OLD_KEY and configure the new private root consistently. Preview: yarn mercato entities rotate-encryption-key --tenant <tenant-id> --dry-run. Then run: yarn mercato entities rotate-encryption-key --tenant <tenant-id>. Repeat for each tenant. This command does not migrate every system-scoped secret, credential envelope or lookup hash; preserve the existing lookup pepper until those hashes are migrated. See https://docs.openmercato.com/user-guide/encryption#startup-key-provisioning-and-existing-installations for the backup and rotation procedure.`
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().replace(/(?:^['"]|['"]$)/g, '')
}

function configurationError(message: string): Error {
  return new Error(`Tenant encryption configuration: ${message}. Startup stopped; preserve existing keys and migrate encrypted data and lookup hashes before changing them.`)
}

function readFiles(appDir: string, mode: string, envFileMode: 'next' | 'dotenv') {
  const names = envFileMode === 'dotenv' ? ['.env'] : [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env']
  return names.flatMap((name) => {
    const filePath = path.join(appDir, name)
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return [{ filePath, content, values: parseEnv(content), existing: true }]
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw configurationError(`cannot read ${name}; check file permissions`)
    }
  })
}

function replaceValues(content: string, values: Record<string, string>): string {
  const remaining = new Set(Object.keys(values))
  const updated = content.replace(
    /^([\t ]*(?:export[\t ]+)?)([A-Za-z_][\w]*)[\t ]*=[\t ]*(?:'[^']*'|"(?:\\.|[^"\\])*"|`[^`]*`|[^\r\n]*)[^\r\n]*/gm,
    (assignment, prefix: string, name: string) => {
      if (!Object.hasOwn(values, name)) return assignment
      remaining.delete(name)
      return `${prefix}${name}=${values[name]}`
    },
  )
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const appended = [...remaining].map((name) => `${name}=${values[name]}${newline}`).join('')
  return updated + (appended && updated && !updated.endsWith('\n') ? newline : '') + appended
}

function writePrivateFile(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${crypto.randomBytes(12).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temporaryPath, content, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporaryPath, filePath)
  } catch {
    throw configurationError(`cannot persist keys in ${path.basename(filePath)}; make the env file writable or supply private keys through the environment`)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

/** @internal Prepare keys before dotenv or application bootstrap can consume them. */
export async function prepareEncryptionEnv(
  appDir: string,
  {
    env = process.env,
    mode = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development',
    onWarning = warnOnce,
    onChange = (message) => createLogger('shared:encryption-startup').info(message),
    envFileMode = 'next',
  }: {
    env?: NodeJS.ProcessEnv
    mode?: 'development' | 'production' | 'test'
    onWarning?: (message: string) => void
    onChange?: (message: string) => void
    envFileMode?: 'next' | 'dotenv'
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const unsafeWarning = 'OM_ENCRYPTION_STARTUP_UNSAFE_SKIP is enabled: automatic encryption key provisioning and configuration checks are bypassed. This preserves the previous unsafe behavior; disable this option to restore startup key protection.'
  if (parseBooleanToken(env.OM_ENCRYPTION_STARTUP_UNSAFE_SKIP) === true) {
    onWarning(unsafeWarning)
    return {}
  }
  const plan = () => {
    const files = readFiles(appDir, mode, envFileMode)
    const examplePath = path.join(appDir, '.env.example')
    if (
      !files.length && mode !== 'production' &&
      !normalize(env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY) && !normalize(env.TENANT_DATA_ENCRYPTION_KEY) &&
      fs.existsSync(examplePath)
    ) {
      const content = fs.readFileSync(examplePath, 'utf8')
      files.push({ filePath: path.join(appDir, '.env'), content, values: parseEnv(content), existing: false })
    }
    const fileValue = (name: string) => files.find((file) => Object.hasOwn(file.values, name))
    const effectiveValue = (name: string) => normalize(env[name]) ? env[name] : fileValue(name)?.values[name]
    if (parseBooleanToken(effectiveValue('OM_ENCRYPTION_STARTUP_UNSAFE_SKIP')) === true) {
      return { files, warnings: [unsafeWarning], result: {}, updates: new Map<string, Record<string, string>>() }
    }
    const toggle = env.TENANT_DATA_ENCRYPTION ?? fileValue('TENANT_DATA_ENCRYPTION')?.values.TENANT_DATA_ENCRYPTION
    const warnings: string[] = []
    if (parseBooleanToken(toggle) === false) return { files, warnings, result: { TENANT_DATA_ENCRYPTION: toggle }, updates: new Map<string, Record<string, string>>() }

    const result: NodeJS.ProcessEnv = { TENANT_DATA_ENCRYPTION: toggle }
    for (const name of keyNames) {
      const inherited = normalize(env[name])
      const file = fileValue(name)
      if (inherited && file && inherited !== normalize(file.values[name])) {
        warnings.push(rotationWarning(name, `in the process environment differs from ${path.basename(file.filePath)}; existing environment precedence is preserved. Verify the effective key matches the data before allowing writes; restore matching configuration if this override was unintended`))
      } else if (inherited && !file && !publishedKeys.has(inherited)) {
        warnings.push(rotationWarning(name, 'is managed outside the env files and cannot be safely updated automatically; keep the same key across every instance and keep a protected backup'))
      }
      const value = normalize(effectiveValue(name))
      if (publishedKeys.has(value)) {
        if (!inherited && file && !file.existing && name !== 'LOOKUP_HASH_PEPPER') {
          result[name] = ''
          continue
        }
        warnings.push(rotationWarning(name))
      }
      if (effectiveValue(name) !== undefined) result[name] = effectiveValue(name)
    }

    const fallback = normalize(result.TENANT_DATA_ENCRYPTION_FALLBACK_KEY)
    const legacy = normalize(result.TENANT_DATA_ENCRYPTION_KEY)
    const configuredKey = fallback || legacy
    const updates = new Map<string, Record<string, string>>()
    if (configuredKey) return { files, warnings, result, updates }

    const otherFiles = envFileMode === 'dotenv' ? readFiles(appDir, mode, 'next') : files
    if (otherFiles.some((file) => file.existing && keyNames.slice(0, 2).some((name) => normalize(file.values[name])))) {
      warnings.push(rotationWarning('Tenant encryption', 'has a configured root shadowed by the current env-file precedence; no new root was generated. Align the startup configuration before writing data'))
      return { files, warnings, result, updates }
    }

    if (
      mode !== 'production' && parseBooleanToken(effectiveValue('ALLOW_DERIVED_KMS_FALLBACK')) === true &&
      (normalize(env.ALLOW_DERIVED_KMS_FALLBACK) || files.some((file) => file.existing))
    ) {
      result.ALLOW_DERIVED_KMS_FALLBACK = effectiveValue('ALLOW_DERIVED_KMS_FALLBACK')
      warnings.push(rotationWarning('ALLOW_DERIVED_KMS_FALLBACK'))
      return { files, warnings, result, updates }
    }

    const root = crypto.randomBytes(32).toString('hex')
    for (const name of keyNames.slice(0, 2)) {
      const current = normalize(result[name])
      if (current) continue
      result[name] = root
      const target = fileValue(name)?.filePath ?? path.join(appDir, '.env')
      updates.set(target, { ...updates.get(target), [name]: root })
    }
    return { files, warnings, result, updates }
  }

  const initial = plan()
  if (!initial.updates.size) {
    for (const warning of initial.warnings) onWarning(warning)
    return initial.result
  }

  const lockPath = path.join(appDir, '.env.encryption.lock')
  const deadline = Date.now() + 5000
  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 })
      break
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw configurationError('cannot create the env key lock; make the app directory writable or supply private keys through the environment')
      }
      if (Date.now() >= deadline) throw configurationError('another startup holds .env.encryption.lock; retry, or remove a stale lock after stopping that process')
      await delay(25)
    }
  }
  try {
    const { files, warnings, result, updates } = plan()
    for (const [filePath, values] of updates) {
      const content = files.find((file) => file.filePath === filePath)?.content ?? ''
      writePrivateFile(filePath, replaceValues(content, values))
      const existing = files.find((file) => file.filePath === filePath)?.existing
      onChange(`Tenant encryption: ${existing ? 'updated' : 'created'} ${filePath}; generated random keys for ${Object.keys(values).join(', ')}. Keep this file private and back it up with your database. Key values are not printed.`)
    }
    for (const warning of warnings) onWarning(warning)
    return result
  } finally {
    fs.rmdirSync(lockPath)
  }
}
