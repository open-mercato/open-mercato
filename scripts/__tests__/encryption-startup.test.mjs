import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'
import { parse as parseDotenv } from 'dotenv'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fallbackName = 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY'
const legacyName = 'TENANT_DATA_ENCRYPTION_KEY'
const published = 'dev-tenant-encryption-fallback-key-32chars'
const privateKey = 'private-installation-key-that-must-not-change'
const otherKey = 'another-private-installation-key-must-not-leak'
let temporaryRoot
let liveTemporaryRoot
let prepareEncryptionEnv
let prepareAppEncryptionEnv
let createKmsService
let encryptWithAesGcm
let decryptWithAesGcm
let hashForLookup

before(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'encryption-startup-'))
  if (process.env.OM_ENCRYPTION_STARTUP_LIVE === '1') liveTemporaryRoot = fs.mkdtempSync(path.join(root, '.ai/.startup-live-'))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporaryRoot, 'node_modules'), 'dir')
  const alias = {
    '@open-mercato/shared/lib/encryption/prepareEnv': path.join(root, 'packages/shared/src/lib/encryption/prepareEnv.ts'),
    '@open-mercato/shared/lib/boolean': path.join(root, 'packages/shared/src/lib/boolean.ts'),
  }
  await build({
    entryPoints: {
      prepare: alias['@open-mercato/shared/lib/encryption/prepareEnv'],
      cli: path.join(root, 'packages/cli/src/lib/load-env.ts'),
      kms: path.join(root, 'packages/shared/src/lib/encryption/kms.ts'),
      aes: path.join(root, 'packages/shared/src/lib/encryption/aes.ts'),
    },
    outdir: temporaryRoot, outExtension: { '.js': '.mjs' },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', alias,
  })
  ;({ prepareEncryptionEnv } = await import(pathToFileURL(path.join(temporaryRoot, 'prepare.mjs')).href))
  ;({ prepareAppEncryptionEnv } = await import(pathToFileURL(path.join(temporaryRoot, 'cli.mjs')).href))
  ;({ createKmsService } = await import(pathToFileURL(path.join(temporaryRoot, 'kms.mjs')).href))
  ;({ encryptWithAesGcm, decryptWithAesGcm, hashForLookup } = await import(pathToFileURL(path.join(temporaryRoot, 'aes.mjs')).href))
  for (const [name, config] of [
    ['monorepo', 'apps/mercato/next.config.ts'],
    ['standalone', 'packages/create-app/template/next.config.ts'],
  ]) {
    await build({
      entryPoints: [path.join(root, config)], outfile: path.join(temporaryRoot, `${name}.mjs`),
      bundle: true, platform: 'node', format: 'esm', packages: 'external', alias,
      plugins: [{
        name: 'unrelated-next-config-settings',
        setup(builder) {
          builder.onResolve({ filter: /contentSecurityPolicy|telemetry\/nextjs-config|dev-origins$/ }, (args) => ({ path: args.path, namespace: 'config-setting' }))
          builder.onLoad({ filter: /.*/, namespace: 'config-setting' }, () => ({ contents: `
            export const createContentSecurityPolicy = () => ''
            export const stripeContentSecurityPolicy = { connectOrigins: [] }
            export const resolveDocumentsCollaborationCspOrigins = () => []
            export const telemetryServerExternalPackages = []
            export const resolveAllowedDevOrigins = () => []
          ` }))
        },
      }],
    })
  }
})

after(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
  if (liveTemporaryRoot) fs.rmSync(liveTemporaryRoot, { recursive: true, force: true })
})

function fixture(content = `${fallbackName}=\n${legacyName}=\n`) {
  const appDir = fs.mkdtempSync(path.join(temporaryRoot, 'app-'))
  fs.writeFileSync(path.join(appDir, 'package.json'), '{"type":"module","name":"encryption-fixture"}')
  fs.mkdirSync(path.join(appDir, 'src'))
  fs.mkdirSync(path.join(appDir, 'node_modules/@open-mercato/core'), { recursive: true })
  fs.writeFileSync(path.join(appDir, 'src/modules.ts'), 'export const enabledModules = []')
  if (content !== null) fs.writeFileSync(path.join(appDir, '.env'), content)
  return appDir
}

function run(script, cwd, extraEnv = {}) {
  const env = { ...process.env }
  for (const name of [fallbackName, legacyName, 'LOOKUP_HASH_PEPPER', 'TENANT_DATA_ENCRYPTION', 'ALLOW_DERIVED_KMS_FALLBACK', 'OM_ENCRYPTION_STARTUP_UNSAFE_SKIP', '__NEXT_PROCESSED_ENV']) delete env[name]
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd, env: { ...env, ...extraEnv }, timeout: 15000,
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

test('persists private random keys once, keeps unrelated settings, and restarts with the same keys', async () => {
  const appDir = fixture(`# Keep this comment\r\nDATABASE_URL=unchanged\r\nexport ${fallbackName}="" # placeholder\r\n${legacyName}=''\r\n`)
  const values = await prepareEncryptionEnv(appDir, { env: {} })
  assert.match(values[fallbackName], /^[a-f0-9]{64}$/)
  assert.equal(values[legacyName], values[fallbackName])
  const filename = path.join(appDir, '.env')
  const content = fs.readFileSync(filename, 'utf8')
  assert.match(content, /# Keep this comment\r\nDATABASE_URL=unchanged/)
  assert.equal(parseEnv(content)[fallbackName], values[fallbackName])
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600)
  assert.deepEqual(await prepareEncryptionEnv(appDir, { env: {} }), values)
  assert.equal(fs.readFileSync(filename, 'utf8'), content)
  assert.ok(!fs.existsSync(path.join(appDir, '.env.encryption.lock')))
})

test('copies the example before creating keys, preserving database configuration', async () => {
  const appDir = fixture(null)
  fs.writeFileSync(path.join(appDir, '.env.example'), `DATABASE_URL=example-db\n${fallbackName}=\n`)
  await prepareEncryptionEnv(appDir, { env: {} })
  assert.equal(parseEnv(fs.readFileSync(path.join(appDir, '.env'), 'utf8')).DATABASE_URL, 'example-db')
})

test('announces every created or updated env file and filled variable without revealing key material', async () => {
  for (const existing of [true, false]) {
    const appDir = fixture(existing ? undefined : null)
    const notices = []
    const values = await prepareEncryptionEnv(appDir, { env: {}, onChange: (message) => notices.push(message) })
    assert.equal(notices.length, 1)
    assert.match(notices[0], new RegExp(existing ? 'updated' : 'created'))
    assert.ok(notices[0].includes(path.join(appDir, '.env')))
    assert.ok(notices[0].includes(fallbackName))
    assert.ok(notices[0].includes(legacyName))
    assert.ok(!notices[0].includes(values[fallbackName]))
    await prepareEncryptionEnv(appDir, { env: {}, onChange: (message) => notices.push(message) })
    assert.equal(notices.length, 1)
  }
})

for (const source of ['process', 'file']) {
  test(`unsafe opt-out from ${source} preserves previous behavior and warns without modifying files`, async () => {
    const content = source === 'file' ? `OM_ENCRYPTION_STARTUP_UNSAFE_SKIP=true\n${fallbackName}=\n` : `${fallbackName}=\n`
    const appDir = fixture(content)
    const warnings = []
    const values = await prepareEncryptionEnv(appDir, {
      env: source === 'process' ? { OM_ENCRYPTION_STARTUP_UNSAFE_SKIP: 'true' } : {},
      onWarning: (message) => warnings.push(message),
      onChange: () => assert.fail('unsafe bypass must not change env files'),
    })
    assert.deepEqual(values, {})
    assert.match(warnings[0], /previous unsafe behavior/)
    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
  })
}

test('the unsafe opt-out is off by default and explicit false still provisions keys', async () => {
  const appDir = fixture('OM_ENCRYPTION_STARTUP_UNSAFE_SKIP=false\n')
  const values = await prepareEncryptionEnv(appDir, { env: {} })
  assert.match(values[fallbackName], /^[a-f0-9]{64}$/)
})

test('existing ciphertext and lookup hashes remain readable after startup with a published fallback', async () => {
  const before = { ...process.env }
  try {
    for (const name of ['VAULT_ADDR', 'VAULT_TOKEN', legacyName, 'LOOKUP_HASH_PEPPER']) delete process.env[name]
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env[fallbackName] = published
    const originalDek = await createKmsService().getTenantDek('fixture-tenant')
    const ciphertext = encryptWithAesGcm('existing protected data', originalDek.key).raw
    const originalHash = hashForLookup('existing@example.com')
    const appDir = fixture(`${fallbackName}=${published}\n`)
    const values = await prepareEncryptionEnv(appDir, { env: process.env, onWarning: () => {} })
    Object.assign(process.env, values)
    const currentDek = await createKmsService().getTenantDek('fixture-tenant')
    assert.equal(currentDek.key, originalDek.key)
    assert.equal(decryptWithAesGcm(ciphertext, currentDek.key), 'existing protected data')
    assert.equal(hashForLookup('existing@example.com'), originalHash)
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name]
    Object.assign(process.env, before)
  }
})

for (const defaultKey of [published, 'om-dev-tenant-encryption']) {
  test(`preserves the existing published file key ${defaultKey} and warns with backup and rotation instructions`, async () => {
    const content = `${fallbackName}="${defaultKey}"\n${legacyName}=\n`
    const appDir = fixture(content)
    const warnings = []
    const values = await prepareEncryptionEnv(appDir, { env: {}, onWarning: (message) => warnings.push(message) })
    assert.equal(values[fallbackName], defaultKey)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /back up the database AND current env files\/keys/)
    assert.match(warnings[0], /yarn mercato entities rotate-encryption-key --tenant <tenant-id> --dry-run/)
    assert.match(warnings[0], /yarn mercato entities rotate-encryption-key --tenant <tenant-id>\./)
    assert.match(warnings[0], /TENANT_DATA_ENCRYPTION_OLD_KEY/)
    assert.ok(!warnings[0].includes(defaultKey))
    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
  })
}

test('provisions private keys when copying an unpublished example containing a dummy root', async () => {
  const appDir = fixture(null)
  const content = `${fallbackName}=${published}\n`
  fs.writeFileSync(path.join(appDir, '.env.example'), content)
  const values = await prepareEncryptionEnv(appDir, { env: {} })
  assert.match(values[fallbackName], /^[a-f0-9]{64}$/)
  assert.equal(parseEnv(fs.readFileSync(path.join(appDir, '.env'), 'utf8'))[fallbackName], values[fallbackName])
  assert.equal(fs.readFileSync(path.join(appDir, '.env.example'), 'utf8'), content)
})

test('preserves externally managed published keys without a saved env file and warns', async () => {
  const appDir = fixture(null)
  const warnings = []
  const values = await prepareEncryptionEnv(appDir, { env: { [fallbackName]: published }, onWarning: (message) => warnings.push(message) })
  assert.equal(values[fallbackName], published)
  assert.equal(warnings.length, 1)
  assert.ok(!fs.existsSync(path.join(appDir, '.env')))
})

test('accepts a published process key matching existing persisted configuration and warns', async () => {
  const appDir = fixture(`${fallbackName}=${published}\n`)
  const warnings = []
  const values = await prepareEncryptionEnv(appDir, { env: { [fallbackName]: published }, onWarning: (message) => warnings.push(message) })
  assert.equal(values[fallbackName], published)
  assert.equal(warnings.length, 1)
})

test('keeps private roots and dedicated lookup peppers byte-for-byte', async () => {
  const content = `${fallbackName}="${privateKey}"\n${legacyName}=${otherKey}\nLOOKUP_HASH_PEPPER=dedicated-pepper\n`
  const appDir = fixture(content)
  const values = await prepareEncryptionEnv(appDir, { env: {} })
  assert.equal(values[fallbackName], privateKey)
  assert.equal(values[legacyName], otherKey)
  assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
})

test('preserves dotenv escape semantics for existing private keys', async () => {
  const content = `${fallbackName}="private\\nroot\\rwith-escapes"\n${legacyName}=\n`
  const appDir = fixture(content)
  const values = await prepareEncryptionEnv(appDir, { env: {} })
  assert.equal(values[fallbackName], parseDotenv(content)[fallbackName])
  assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
})

test('keeps the legacy root and empty preferred key unchanged, ignoring empty shell overrides', async () => {
  const content = `${fallbackName}=\n${legacyName}=${privateKey}\n`
  const appDir = fixture(content)
  const values = await prepareEncryptionEnv(appDir, { env: { [legacyName]: '' } })
  assert.equal(values[fallbackName], '')
  assert.equal(values[legacyName], privateKey)
  assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
})

test('never replaces a published legacy key or file lookup pepper, even alongside a private preferred key', async () => {
  for (const name of [legacyName, 'LOOKUP_HASH_PEPPER']) {
    const content = `${fallbackName}=${privateKey}\n${name}=${published}\n`
    const appDir = fixture(content)
    const warnings = []
    await prepareEncryptionEnv(appDir, { env: {}, onWarning: (message) => warnings.push(message) })
    assert.equal(warnings.length, 1)
    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
  }
})

test('preserves an existing opt-in implicit development root with a warning', async () => {
  const content = `ALLOW_DERIVED_KMS_FALLBACK=true\n${fallbackName}=\n${legacyName}=\n`
  const appDir = fixture(content)
  const warnings = []
  const values = await prepareEncryptionEnv(appDir, { env: {}, onWarning: (message) => warnings.push(message) })
  assert.equal(values[fallbackName], '')
  assert.equal(values.ALLOW_DERIVED_KMS_FALLBACK, 'true')
  assert.equal(warnings.length, 1)
  assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
})

test('preserves an externally managed implicit development root and warns without creating files', async () => {
  const appDir = fixture(null)
  const warnings = []
  const values = await prepareEncryptionEnv(appDir, { env: { ALLOW_DERIVED_KMS_FALLBACK: 'true' }, onWarning: (message) => warnings.push(message) })
  assert.equal(values.ALLOW_DERIVED_KMS_FALLBACK, 'true')
  assert.equal(warnings.length, 1)
  assert.ok(!fs.existsSync(path.join(appDir, '.env')))
})

for (const disabled of ['no', 'false', '0', 'off', 'disabled']) {
  test(`does not touch keys when encryption is ${disabled}`, async () => {
    const content = `TENANT_DATA_ENCRYPTION=${disabled}\n${fallbackName}=${published}\n`
    const appDir = fixture(content)
    await prepareEncryptionEnv(appDir, { env: { [fallbackName]: published } })
    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
  })
}

for (const name of [fallbackName, legacyName, 'LOOKUP_HASH_PEPPER']) {
  test(`warns about inherited published or conflicting ${name} without changing either source or leaking secrets`, async () => {
    for (const inherited of [published, 'om-dev-tenant-encryption', otherKey]) {
      const content = `${fallbackName}=${privateKey}\n${name}=${privateKey}\n`
      const appDir = fixture(content)
      const warnings = []
      const values = await prepareEncryptionEnv(appDir, { env: { [name]: inherited }, onWarning: (message) => warnings.push(message) })
      assert.equal(values[name], inherited)
      assert.ok(warnings.length > 0)
      assert.match(warnings.join('\n'), new RegExp(name))
      assert.ok(!warnings.join('\n').includes(privateKey))
      assert.ok(!warnings.join('\n').includes(inherited))
      assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
    }
  })
}

test('warns and preserves a private process key that overrides an empty file key', async () => {
  const warnings = []
  const values = await prepareEncryptionEnv(fixture(), { env: { [fallbackName]: privateKey }, onWarning: (message) => warnings.push(message) })
  assert.equal(values[fallbackName], privateKey)
  assert.match(warnings[0], /differs from .env/)
})

test('accepts matching environment values and env-only deployments without writing files', async () => {
  const appDir = fixture(`${fallbackName}=${privateKey}\n${legacyName}=${privateKey}\n`)
  await prepareEncryptionEnv(appDir, { env: { [fallbackName]: privateKey } })
  const envOnly = fixture(null)
  assert.equal((await prepareEncryptionEnv(envOnly, { env: { [fallbackName]: privateKey } }))[fallbackName], privateKey)
  assert.ok(!fs.existsSync(path.join(envOnly, '.env')))
})

test('uses mode-specific env-file precedence and skips .env.local in test mode', async () => {
  const appDir = fixture(`${fallbackName}=${privateKey}\n${legacyName}=${privateKey}\n`)
  fs.writeFileSync(path.join(appDir, '.env.production.local'), `${fallbackName}=${otherKey}\n`)
  fs.writeFileSync(path.join(appDir, '.env.local'), `${fallbackName}=${otherKey}\n`)
  assert.equal((await prepareEncryptionEnv(appDir, { env: {}, mode: 'production' }))[fallbackName], otherKey)
  assert.equal((await prepareEncryptionEnv(appDir, { env: {}, mode: 'test' }))[fallbackName], privateKey)
  const warnings = []
  const values = await prepareEncryptionEnv(appDir, { env: { [fallbackName]: privateKey }, mode: 'production', onWarning: (message) => warnings.push(message) })
  assert.equal(values[fallbackName], privateKey)
  assert.match(warnings[0], /differs from .env.production.local/)
})

test('preserves the existing CLI .env precedence instead of switching configured roots to .env.local', async () => {
  const appDir = fixture(`${fallbackName}=${privateKey}\n`)
  fs.writeFileSync(path.join(appDir, '.env.local'), `${fallbackName}=${otherKey}\n`)
  const values = await prepareEncryptionEnv(appDir, { env: {}, envFileMode: 'dotenv' })
  assert.equal(values[fallbackName], privateKey)
  assert.equal((await prepareEncryptionEnv(appDir, { env: {} }))[fallbackName], otherKey)
})

test('never generates another root when an existing key is shadowed by empty env-file values', async () => {
  for (const mode of ['next', 'dotenv']) {
    const appDir = fixture(mode === 'next' ? `${fallbackName}=${privateKey}\n` : `${fallbackName}=\n`)
    const local = mode === 'next' ? `${fallbackName}=\n` : `${fallbackName}=${privateKey}\n`
    fs.writeFileSync(path.join(appDir, '.env.local'), local)
    const originalContent = fs.readFileSync(path.join(appDir, '.env'), 'utf8')
    const warnings = []
    const values = await prepareEncryptionEnv(appDir, { env: {}, envFileMode: mode, onWarning: (message) => warnings.push(message) })
    assert.equal(values[fallbackName], '')
    assert.match(warnings[0], /shadowed by the current env-file precedence/)
    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), originalContent)
    assert.equal(fs.readFileSync(path.join(appDir, '.env.local'), 'utf8'), local)
  }
})

test('simultaneous startups use the same persisted root', async () => {
  const appDir = fixture()
  const moduleUrl = pathToFileURL(path.join(temporaryRoot, 'prepare.mjs')).href
  const script = `import crypto from 'node:crypto'; import { prepareEncryptionEnv } from ${JSON.stringify(moduleUrl)}; const values = await prepareEncryptionEnv(process.cwd(), {env:{},onChange:()=>{}}); process.stdout.write(crypto.createHash('sha256').update(values.${fallbackName}).digest('hex'));`
  const results = await Promise.all(Array.from({ length: 6 }, () => run(script, appDir)))
  for (const result of results) assert.equal(result.code, 0, result.output)
  const values = parseEnv(fs.readFileSync(path.join(appDir, '.env'), 'utf8'))
  assert.equal(values[fallbackName], values[legacyName])
  assert.match(values[fallbackName], /^[a-f0-9]{64}$/)
  const fingerprint = crypto.createHash('sha256').update(values[fallbackName]).digest('hex')
  for (const result of results) assert.equal(result.output, fingerprint)
})

test('failed persistence stops startup and releases its lock', async () => {
  const appDir = fixture(null)
  fs.mkdirSync(path.join(appDir, '.env'))
  await assert.rejects(prepareEncryptionEnv(appDir, { env: {} }), /cannot read .env/)
  assert.ok(!fs.existsSync(path.join(appDir, '.env.encryption.lock')))
})

test('a failed atomic rename leaves the old file unchanged and removes temporary files and its lock', async () => {
  const appDir = fixture()
  const filename = path.join(appDir, '.env')
  const content = fs.readFileSync(filename, 'utf8')
  const originalRename = fs.renameSync
  try {
    fs.renameSync = () => { throw new Error('fixture rename failure') }
    await assert.rejects(prepareEncryptionEnv(appDir, { env: {} }), /cannot persist keys/)
  } finally {
    fs.renameSync = originalRename
  }
  assert.equal(fs.readFileSync(filename, 'utf8'), content)
  assert.ok(!fs.existsSync(path.join(appDir, '.env.encryption.lock')))
  assert.ok(!fs.readdirSync(appDir).some((name) => name.endsWith('.tmp')))
})

for (const command of [['server', 'dev'], ['server', 'start'], ['db', 'greenfield'], ['db', 'migrate'], ['init'], ['seed:defaults'], ['queue', 'work']]) {
  test(`CLI ${command.join(' ')} prepares keys before dotenv and bootstrap`, async () => {
    const appDir = fixture()
    const cliUrl = pathToFileURL(path.join(temporaryRoot, 'cli.mjs')).href
    const result = await run(`import { prepareAppEncryptionEnv } from ${JSON.stringify(cliUrl)}; await prepareAppEncryptionEnv(['node','mercato',...${JSON.stringify(command)}]);`, appDir)
    assert.equal(result.code, 0, result.output)
    assert.match(parseEnv(fs.readFileSync(path.join(appDir, '.env'), 'utf8'))[fallbackName], /^[a-f0-9]{64}$/)
  })
}

for (const command of [['server', 'dev'], ['server', 'start'], ['db', 'greenfield'], ['init']]) {
  test(`monorepo CLI ${command.join(' ')} resolves and protects apps/mercato env files`, async () => {
    const monorepo = fs.mkdtempSync(path.join(temporaryRoot, 'monorepo-'))
    fs.mkdirSync(path.join(monorepo, 'apps'), { recursive: true })
    fs.mkdirSync(path.join(monorepo, 'packages/core/src/modules'), { recursive: true })
    fs.mkdirSync(path.join(monorepo, 'node_modules/@open-mercato/core'), { recursive: true })
    fs.writeFileSync(path.join(monorepo, 'package.json'), '{"name":"fixture-monorepo","workspaces":["apps/*","packages/*"]}')
    const appDir = path.join(monorepo, 'apps/mercato')
    fs.renameSync(fixture(), appDir)
    const cliUrl = pathToFileURL(path.join(temporaryRoot, 'cli.mjs')).href
    const script = `import { prepareAppEncryptionEnv } from ${JSON.stringify(cliUrl)}; await prepareAppEncryptionEnv(['node','mercato',...${JSON.stringify(command)}]);`
    const result = await run(script, monorepo)
    assert.equal(result.code, 0, result.output)
    assert.match(parseEnv(fs.readFileSync(path.join(appDir, '.env'), 'utf8'))[fallbackName], /^[a-f0-9]{64}$/)
    assert.ok(!fs.existsSync(path.join(monorepo, '.env')))
    const content = `${fallbackName}=${published}\n`
    fs.writeFileSync(path.join(appDir, '.env'), content)
    const existingResult = await run(script, monorepo)
    assert.equal(existingResult.code, 0, existingResult.output)
    assert.match(existingResult.output, /back up the database AND current env files\/keys/)
    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
  })
}

test('help, generation and deployment inspection never provision files', async () => {
  const cwd = process.cwd()
  const appDir = fixture(null)
  try {
    process.chdir(appDir)
    for (const command of [['--help'], ['server', 'start', '--help'], ['generate'], ['deploy', 'railway'], ['db', 'generate'], ['module', 'info'], ['test:integration']]) {
      await prepareAppEncryptionEnv(['node', 'mercato', ...command])
    }
    assert.ok(!fs.existsSync(path.join(appDir, '.env')))
  } finally {
    process.chdir(cwd)
  }
})

for (const config of ['monorepo', 'standalone']) {
  for (const mode of ['development', 'production']) {
    test(`${config} direct Next ${mode} startup provisions keys after Next's dotenv load`, async () => {
      const appDir = fixture()
      const configUrl = pathToFileURL(path.join(temporaryRoot, `${config}.mjs`)).href
      const result = await run(`
        import { createRequire } from 'node:module';
        const require = createRequire(process.cwd() + '/package.json');
        const nextEnv = createRequire(require.resolve('next/package.json'))('@next/env');
        nextEnv.loadEnvConfig(process.cwd(), ${mode === 'development'});
        const {default: configure} = await import(${JSON.stringify(configUrl)});
        await configure('phase-${mode}-server');
        if (!/^[a-f0-9]{64}$/.test(process.env.${fallbackName})) throw new Error('missing key');
        nextEnv.resetEnv();
        if (!/^[a-f0-9]{64}$/.test(process.env.${fallbackName})) throw new Error('key lost after Next reset');
      `, appDir, { NODE_ENV: mode })
      assert.equal(result.code, 0, result.output)
    })
  }
  test(`${config} Next preserves env-only published keys with a warning`, async () => {
    const appDir = fixture(null)
    const configUrl = pathToFileURL(path.join(temporaryRoot, `${config}.mjs`)).href
    const result = await run(`const { default: configure } = await import(${JSON.stringify(configUrl)}); await configure('phase-development-server');`, appDir, { [fallbackName]: published })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /published development key/)
    assert.ok(!result.output.includes(published))
  })
  test(`${config} Next preserves existing published keys and prints the backup/rotation warning`, async () => {
    const content = `${fallbackName}=${published}\n`
    const appDir = fixture(content)
    const configUrl = pathToFileURL(path.join(temporaryRoot, `${config}.mjs`)).href
    const result = await run(`const { default: configure } = await import(${JSON.stringify(configUrl)}); await configure('phase-development-server');`, appDir, { [fallbackName]: published, OM_LOG_LEVEL: 'warn' })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /back up the database AND current env files\/keys/)
    assert.match(result.output, /rotate-encryption-key --tenant <tenant-id> --dry-run/)
    assert.ok(!result.output.includes(published))
    assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), content)
  })
}

async function unusedPort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

for (const config of ['monorepo', 'standalone']) {
  for (const variant of ['dev-webpack', 'dev-turbopack', 'production']) {
    for (const scenario of ['empty', 'saved-default', 'external-default', 'unsafe']) {
    test(`${config} live Next HTTP startup (${variant}, ${scenario})`, { skip: process.env.OM_ENCRYPTION_STARTUP_LIVE !== '1', timeout: 120000 }, async () => {
      const originalContent = scenario === 'saved-default' ? `${fallbackName}=${published}\n` : `${fallbackName}=\n${legacyName}=\n`
      const appDir = path.join(liveTemporaryRoot, crypto.randomBytes(8).toString('hex'))
      fs.renameSync(fixture(originalContent), appDir)
      fs.mkdirSync(path.join(appDir, 'app'))
      fs.writeFileSync(path.join(appDir, 'app/layout.js'), 'export default function Layout({ children }) { return <html><body>{children}</body></html> }')
      fs.writeFileSync(path.join(appDir, 'app/page.js'), `import crypto from 'node:crypto'; export const dynamic = 'force-dynamic'; export default function Page() { const fingerprint = crypto.createHash('sha256').update(process.env.${fallbackName} || '').digest('hex'); return <main data-fingerprint={fingerprint}>encryption startup fixture ready</main> }`)
      const configUrl = pathToFileURL(path.join(temporaryRoot, `${config}.mjs`)).href
      fs.writeFileSync(path.join(appDir, 'next.config.mjs'), `
        import configure from ${JSON.stringify(configUrl)};
        export default async (phase) => {
          const config = await configure(phase);
          return {...config, transpilePackages: [], turbopack: {...config.turbopack, root: ${JSON.stringify(path.resolve(fs.realpathSync(path.join(root, 'node_modules/next')), '../..'))}}};
        };
      `)
      const nextBin = path.join(root, 'node_modules/next/dist/bin/next')
      const env = { ...process.env, NODE_ENV: variant === 'production' ? 'production' : 'development', NEXT_TELEMETRY_DISABLED: '1' }
      for (const name of [fallbackName, legacyName, 'LOOKUP_HASH_PEPPER', 'TENANT_DATA_ENCRYPTION', 'ALLOW_DERIVED_KMS_FALLBACK', 'OM_ENCRYPTION_STARTUP_UNSAFE_SKIP', '__NEXT_PROCESSED_ENV']) delete env[name]
      if (scenario === 'external-default') env[fallbackName] = published
      if (scenario === 'unsafe') env.OM_ENCRYPTION_STARTUP_UNSAFE_SKIP = 'true'
      if (variant === 'production') {
        const result = await new Promise((resolve, reject) => {
          const build = spawn(process.execPath, [nextBin, 'build', '--webpack'], { cwd: appDir, env, timeout: 60000 })
          let output = ''
          build.stdout.on('data', (chunk) => { output += chunk })
          build.stderr.on('data', (chunk) => { output += chunk })
          build.on('error', reject)
          build.on('close', (code) => resolve({ code, output }))
        })
        assert.equal(result.code, 0, result.output)
        assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), originalContent)
      }
      const port = await unusedPort()
      const args = [nextBin, variant === 'production' ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(port)]
      if (variant === 'dev-webpack') args.push('--webpack')
      if (variant === 'dev-turbopack') args.push('--turbopack')
      const child = spawn(process.execPath, args, { cwd: appDir, env, detached: process.platform !== 'win32' })
      let output = ''
      let exited = false
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
      const closed = new Promise((resolve) => child.on('close', () => { exited = true; resolve() }))
      try {
        const deadline = Date.now() + 60000
        let ready = false
        let page = ''
        while (Date.now() < deadline && !exited) {
          try {
            const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })
            page = await response.text()
            if (response.ok && page.includes('encryption startup fixture ready')) {
              ready = true
              break
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        assert.ok(ready, output)
        const keys = parseEnv(fs.readFileSync(path.join(appDir, '.env'), 'utf8'))
        if (scenario === 'empty') {
          assert.match(keys[fallbackName], /^[a-f0-9]{64}$/)
          assert.match(output, /generated random keys/)
          assert.ok(!output.includes(keys[fallbackName]))
        } else {
          assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), originalContent)
          assert.match(output, scenario === 'unsafe' ? /previous unsafe behavior/ : /back up the database AND current env files\/keys/)
        }
        const effectiveKey = scenario === 'empty' ? keys[fallbackName] : scenario === 'unsafe' ? '' : published
        assert.ok(page.includes(crypto.createHash('sha256').update(effectiveKey).digest('hex')), 'server runtime must retain the configured root')
      } finally {
        if (!exited) {
          if (process.platform === 'win32') child.kill('SIGTERM')
          else process.kill(-child.pid, 'SIGTERM')
          await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))])
          if (!exited) {
            if (process.platform === 'win32') child.kill('SIGKILL')
            else process.kill(-child.pid, 'SIGKILL')
            await closed
          }
        }
      }
    })
  }
}
}
