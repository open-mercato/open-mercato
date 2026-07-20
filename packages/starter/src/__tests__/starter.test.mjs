import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { parseComposePsOutput, resolveRepoRoot } from '../compose.mjs'
import { hostTrustEnv, summarizeProbeResults, writeCaBundle } from '../certs.mjs'
import { DEFAULT_OPENCODE_BASE_IMAGE, DEFAULT_PORTS, resolveStackPorts } from '../constants.mjs'
import { addEnvValue, readEnvValue, setEnvValue } from '../env-file.mjs'
import { ensureLlmProvider, syncProviderConfigToAppEnv } from '../providers.mjs'
import { ensureWindowsUtf8Console, resolveSpawnCommand } from '../spawn.mjs'
import { StepBlocked, buildToolchainStep, clearConvergenceState, listMigrationModules, migrationsFingerprint, readAppliedMigrationModules, resolveOpencodeBaseImage, runSteps } from '../steps.mjs'
import { checkBuildToolchain } from '../doctor.mjs'

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function makeFakeRepo() {
  const dir = makeTempDir('om-starter-repo-')
  fs.mkdirSync(path.join(dir, 'starters', 'docker'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'starters', 'docker', 'compose.infra.yml'), 'services: {}\n')
  return dir
}

test('ensureWindowsUtf8Console switches the console code page only on win32 and never throws', () => {
  const calls = []
  const fakeSpawnSync = (command, args) => {
    calls.push({ command, args })
    return { status: 0 }
  }

  assert.equal(ensureWindowsUtf8Console({ platform: 'linux', spawnSyncImpl: fakeSpawnSync }), false)
  assert.equal(calls.length, 0)

  assert.equal(ensureWindowsUtf8Console({ platform: 'win32', spawnSyncImpl: fakeSpawnSync, systemRoot: 'C:\\Windows' }), true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['65001'])
  assert.ok(calls[0].command.endsWith(path.join('System32', 'chcp.com')))

  const throwingSpawnSync = () => {
    throw new Error('no console attached')
  }
  assert.equal(ensureWindowsUtf8Console({ platform: 'win32', spawnSyncImpl: throwingSpawnSync }), false)
})

test('resolveRepoRoot walks up to the compose marker and returns null outside a repo', () => {
  const repo = makeFakeRepo()
  const nested = path.join(repo, 'packages', 'starter', 'src')
  fs.mkdirSync(nested, { recursive: true })
  assert.equal(resolveRepoRoot(nested), repo)
  const outside = makeTempDir('om-starter-outside-')
  assert.equal(resolveRepoRoot(outside), null)
})

test('parseComposePsOutput accepts both NDJSON and array formats', () => {
  const ndjson = '{"Service":"postgres","State":"running"}\n{"Service":"redis","State":"exited"}'
  assert.equal(parseComposePsOutput(ndjson).length, 2)
  const array = '[{"Service":"postgres","State":"running"}]'
  assert.equal(parseComposePsOutput(array)[0].Service, 'postgres')
  assert.deepEqual(parseComposePsOutput(''), [])
})

test('addEnvValue is fill-missing-only and replaceEmpty fills bare placeholders', () => {
  const dir = makeTempDir('om-starter-env-')
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(envPath, 'EXISTING=keep\nEMPTY=\n')
  assert.equal(addEnvValue(envPath, 'EXISTING', 'overwrite'), false)
  assert.equal(readEnvValue(envPath, 'EXISTING'), 'keep')
  assert.equal(addEnvValue(envPath, 'EMPTY', 'filled', { replaceEmpty: true }), true)
  assert.equal(readEnvValue(envPath, 'EMPTY'), 'filled')
  assert.equal(addEnvValue(envPath, 'NEW', 'value'), true)
  assert.equal(readEnvValue(envPath, 'NEW'), 'value')
})

test('setEnvValue overwrites existing lines and appends missing ones', () => {
  const dir = makeTempDir('om-starter-setenv-')
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(envPath, 'OM_AI_PROVIDER=openai\nOTHER=keep\n')
  assert.equal(setEnvValue(envPath, 'OM_AI_PROVIDER', 'azure'), true)
  assert.equal(readEnvValue(envPath, 'OM_AI_PROVIDER'), 'azure')
  assert.equal(readEnvValue(envPath, 'OTHER'), 'keep')
  assert.equal(setEnvValue(envPath, 'OM_AI_MODEL', 'my-deployment'), true)
  assert.equal(readEnvValue(envPath, 'OM_AI_MODEL'), 'my-deployment')
})

test('syncProviderConfigToAppEnv mirrors root AI config into the app env without rotating keys', () => {
  const dir = makeTempDir('om-starter-llm-sync-')
  const rootEnv = path.join(dir, '.env')
  const appEnv = path.join(dir, 'app.env')
  fs.writeFileSync(rootEnv, 'OM_AI_PROVIDER=azure\nOM_AI_MODEL=my-deployment\nAZURE_OPENAI_API_KEY=root-secret\nAZURE_OPENAI_BASE_URL=https://example.azure.com\n')
  fs.writeFileSync(appEnv, 'OM_AI_PROVIDER=openai\nOM_AI_MODEL=gpt-5-mini\nAZURE_OPENAI_API_KEY=\nAZURE_OPENAI_BASE_URL=\n')

  syncProviderConfigToAppEnv({ rootEnv, appEnv }, () => {})

  assert.equal(readEnvValue(appEnv, 'OM_AI_PROVIDER'), 'azure')
  assert.equal(readEnvValue(appEnv, 'OM_AI_MODEL'), 'my-deployment')
  assert.equal(readEnvValue(appEnv, 'AZURE_OPENAI_API_KEY'), 'root-secret')
  assert.equal(readEnvValue(appEnv, 'AZURE_OPENAI_BASE_URL'), 'https://example.azure.com')

  fs.writeFileSync(appEnv, 'OM_AI_PROVIDER=azure\nAZURE_OPENAI_API_KEY=manually-rotated\n')
  syncProviderConfigToAppEnv({ rootEnv, appEnv }, () => {})
  assert.equal(readEnvValue(appEnv, 'AZURE_OPENAI_API_KEY'), 'manually-rotated')

  syncProviderConfigToAppEnv({ rootEnv, appEnv: path.join(dir, 'missing.env') }, () => {})
  syncProviderConfigToAppEnv({ rootEnv, appEnv: null }, () => {})
})

test('ensureLlmProvider syncs the app env when the root env is already configured', async () => {
  const dir = makeTempDir('om-starter-llm-configured-')
  const rootEnv = path.join(dir, '.env')
  const appEnv = path.join(dir, 'app.env')
  fs.writeFileSync(rootEnv, 'OM_AI_PROVIDER=azure\nOM_AI_MODEL=my-deployment\nAZURE_OPENAI_API_KEY=root-secret\n')
  fs.writeFileSync(appEnv, 'OM_AI_PROVIDER=openai\nAZURE_OPENAI_API_KEY=\n')

  const outcome = await ensureLlmProvider({ rootEnv, appEnv }, { log: () => {}, warn: () => {} })

  assert.equal(outcome, 'configured')
  assert.equal(readEnvValue(appEnv, 'OM_AI_PROVIDER'), 'azure')
  assert.equal(readEnvValue(appEnv, 'OM_AI_MODEL'), 'my-deployment')
  assert.equal(readEnvValue(appEnv, 'AZURE_OPENAI_API_KEY'), 'root-secret')
})

test('hostTrustEnv wires CA bundle, system CA flag, and corepack proxy fix', () => {
  const env = hostTrustEnv('/tmp/bundle.pem', { NODE_OPTIONS: '--max-old-space-size=2048', HTTPS_PROXY: 'http://proxy:8080' })
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/tmp/bundle.pem')
  assert.ok(env.NODE_OPTIONS.includes('--use-system-ca'))
  assert.ok(env.NODE_OPTIONS.includes('--max-old-space-size=2048'))
  assert.equal(env.NODE_USE_ENV_PROXY, '1')
  const noProxy = hostTrustEnv(null, {})
  assert.equal(noProxy.NODE_EXTRA_CA_CERTS, undefined)
  assert.equal(noProxy.NODE_USE_ENV_PROXY, undefined)
  assert.ok(noProxy.NODE_OPTIONS.includes('--use-system-ca'))
})

test('writeCaBundle merges company bundles and captured certs, returns null when empty', () => {
  const repo = makeFakeRepo()
  const companyBundle = path.join(repo, 'company-ca.pem')
  fs.writeFileSync(companyBundle, '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n')
  const bundlePath = writeCaBundle(repo, {
    companyBundles: [companyBundle],
    capturedPems: [{ fingerprint: 'FP', subject: 'Test Interception CA', pem: '-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----\n' }],
  })
  const content = fs.readFileSync(bundlePath, 'utf8')
  assert.ok(content.includes('AAA'))
  assert.ok(content.includes('BBB'))
  assert.ok(content.includes('Test Interception CA'))
  assert.equal(writeCaBundle(repo, { companyBundles: [], capturedPems: [] }), null)
})

test('summarizeProbeResults buckets probe outcomes', () => {
  const summary = summarizeProbeResults([
    { host: 'a', status: 'ok' },
    { host: 'b', status: 'intercepted' },
    { host: 'c', status: 'unreachable' },
  ])
  assert.equal(summary.clean.length, 1)
  assert.equal(summary.intercepted[0].host, 'b')
  assert.equal(summary.unreachable[0].host, 'c')
})

test('resolveStackPorts honors env overrides and falls back to defaults', () => {
  const repo = makeFakeRepo()
  const ports = resolveStackPorts(repo, { POSTGRES_PORT: '5433', APP_PORT: 'not-a-number' })
  assert.equal(ports.postgres, 5433)
  assert.equal(ports.app, DEFAULT_PORTS.app)
  assert.equal(ports.mcp, DEFAULT_PORTS.mcp)
})

test('resolveSpawnCommand leaves real executables and unix platforms shell-free', () => {
  assert.deepEqual(resolveSpawnCommand('docker', ['compose', 'version'], { platform: 'win32' }), {
    command: 'docker',
    args: ['compose', 'version'],
    spawnOptions: {},
  })
  assert.deepEqual(resolveSpawnCommand('yarn', ['install'], { platform: 'linux' }), {
    command: 'yarn',
    args: ['install'],
    spawnOptions: {},
  })
})

test('resolveSpawnCommand hands cmd.exe one pre-quoted command line for Windows shims', () => {
  const plain = resolveSpawnCommand('yarn', ['--version'], { platform: 'win32' })
  assert.equal(plain.command, 'yarn --version')
  assert.deepEqual(plain.args, [])
  assert.equal(plain.spawnOptions.shell, true)

  const quoted = resolveSpawnCommand('corepack', ['prepare', 'yarn@4.12.0', '--activate'], { platform: 'win32' })
  assert.equal(quoted.command, 'corepack prepare yarn@4.12.0 --activate')

  const spaced = resolveSpawnCommand('yarn.cmd', ['run', 'a b'], { platform: 'win32' })
  assert.equal(spaced.command, 'yarn.cmd run "a b"')
})

test('resolveSpawnCommand rejects cmd metacharacters instead of degrading into injection', () => {
  assert.throws(() => resolveSpawnCommand('yarn', ['%TEMP%'], { platform: 'win32' }))
  assert.throws(() => resolveSpawnCommand('yarn', ['a&whoami'], { platform: 'win32' }))
  assert.throws(() => resolveSpawnCommand('npm', ['pkg|rm'], { platform: 'win32' }))
})

function quietCtx(overrides = {}) {
  return { log: () => {}, flags: {}, company: { steps: { disable: [], extra: [] } }, ...overrides }
}

test('runSteps skips satisfied steps, applies unsatisfied ones, and stops on StepBlocked with guidance', async () => {
  const order = []
  const steps = [
    { id: 'done', title: 'Done', async check() { order.push('check:done'); return { ok: true, detail: 'ok' } }, async apply() { order.push('apply:done') } },
    { id: 'todo', title: 'Todo', async check() { return { ok: false, detail: '' } }, async apply() { order.push('apply:todo') } },
    { id: 'skipped', title: 'Skipped', appliesTo: () => false, async check() { order.push('check:skipped'); return { ok: false } } },
  ]
  const outcome = await runSteps(steps, quietCtx())
  assert.equal(outcome.ok, true)
  assert.deepEqual(order, ['check:done', 'apply:todo'])

  const blocked = await runSteps([
    { id: 'gate', title: 'Gate', async check() { throw new StepBlocked('gate', ['install the thing']) } },
    { id: 'never', title: 'Never', async check() { order.push('check:never'); return { ok: true } } },
  ], quietCtx())
  assert.equal(blocked.ok, false)
  assert.equal(blocked.blockedStep, 'gate')
  assert.ok(!order.includes('check:never'))
})

test('runSteps reports step failures without throwing', async () => {
  const outcome = await runSteps([
    { id: 'boom', title: 'Boom', async check() { return { ok: false } }, async apply() { throw new Error('exploded') } },
  ], quietCtx())
  assert.equal(outcome.ok, false)
  assert.equal(outcome.failedStep, 'boom')
})

test('migrationsFingerprint tracks Migration*.ts files and ignores snapshot dot-files', () => {
  const repo = makeFakeRepo()
  const migrationsDir = path.join(repo, 'packages', 'core', 'src', 'modules', 'demo', 'migrations')
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(path.join(migrationsDir, 'Migration20260101000000.ts'), 'export class M {}\n')
  const initial = migrationsFingerprint(repo)

  fs.writeFileSync(path.join(migrationsDir, '.snapshot-open-mercato.json'), '{"changed":true}\n')
  assert.equal(migrationsFingerprint(repo), initial)

  fs.writeFileSync(path.join(migrationsDir, 'Migration20260102000000.ts'), 'export class M2 {}\n')
  assert.notEqual(migrationsFingerprint(repo), initial)

  const appMigrations = path.join(repo, 'apps', 'mercato', 'src', 'modules', 'local', 'migrations')
  fs.mkdirSync(appMigrations, { recursive: true })
  const withApp = migrationsFingerprint(repo)
  fs.writeFileSync(path.join(appMigrations, 'Migration20260103000000.ts'), 'export class M3 {}\n')
  assert.notEqual(migrationsFingerprint(repo), withApp)
})

test('clearConvergenceState removes markers but keeps mode and db-initialized state', () => {
  const repo = makeFakeRepo()
  const stateDir = path.join(repo, '.mercato', 'starter')
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'mode'), 'hybrid\n')
  fs.writeFileSync(path.join(stateDir, 'install.hash'), 'abc\n')
  fs.writeFileSync(path.join(stateDir, 'db-initialized-cafe01'), 'when\n')
  fs.writeFileSync(path.join(stateDir, 'db-migrations-cafe01'), 'hash\n')

  const cleared = clearConvergenceState(repo)
  assert.deepEqual(cleared.sort(), ['db-migrations-cafe01', 'install.hash'])
  assert.deepEqual(fs.readdirSync(stateDir).sort(), ['db-initialized-cafe01', 'mode'])
  assert.deepEqual(clearConvergenceState(path.join(repo, 'nope')), [])
})

test('listMigrationModules names every module that ships Migration files', () => {
  const repo = makeFakeRepo()
  const orchestratorDir = path.join(repo, 'packages', 'enterprise', 'src', 'modules', 'agent_orchestrator', 'migrations')
  const customersDir = path.join(repo, 'packages', 'core', 'src', 'modules', 'customers', 'migrations')
  const emptyDir = path.join(repo, 'packages', 'core', 'src', 'modules', 'no_migrations', 'migrations')
  fs.mkdirSync(orchestratorDir, { recursive: true })
  fs.mkdirSync(customersDir, { recursive: true })
  fs.mkdirSync(emptyDir, { recursive: true })
  fs.writeFileSync(path.join(orchestratorDir, 'Migration20260101000000_agent_orchestrator.ts'), 'x')
  fs.writeFileSync(path.join(customersDir, 'Migration20260101000000_customers.ts'), 'x')
  fs.writeFileSync(path.join(emptyDir, '.snapshot-open-mercato.json'), '{}')

  const modules = listMigrationModules(repo)
  assert.deepEqual([...modules].sort(), ['agent_orchestrator', 'customers'])
})

test('readAppliedMigrationModules parses psql bookkeeping tables and returns null when the probe fails', () => {
  const repo = makeFakeRepo()
  fs.mkdirSync(path.join(repo, 'apps', 'mercato'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'apps', 'mercato', '.env'), 'DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/open-mercato\n')
  const ctx = { repoRoot: repo }

  let seenArgs = null
  const okCompose = (repoRoot, args) => {
    seenArgs = args
    return { status: 0, stdout: 'mikro_orm_migrations_customers\nmikro_orm_migrations_agent_orchestrator\n\n' }
  }
  const applied = readAppliedMigrationModules(ctx, { runComposeImpl: okCompose })
  assert.deepEqual([...applied].sort(), ['agent_orchestrator', 'customers'])
  assert.ok(seenArgs.includes('open-mercato'))

  assert.equal(readAppliedMigrationModules(ctx, { runComposeImpl: () => ({ status: 1, stdout: '' }) }), null)
  assert.equal(readAppliedMigrationModules(ctx, { runComposeImpl: () => { throw new Error('compose missing') } }), null)
})

test('resolveOpencodeBaseImage: env wins, then .env, then the pinned default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-opencode-'))
  try {
    assert.equal(
      resolveOpencodeBaseImage(root, {}),
      DEFAULT_OPENCODE_BASE_IMAGE,
    )
    fs.writeFileSync(path.join(root, '.env'), 'OPENCODE_BASE_IMAGE=registry.corp/opencode-base:1.18.3\n')
    assert.equal(
      resolveOpencodeBaseImage(root, {}),
      'registry.corp/opencode-base:1.18.3',
    )
    assert.equal(
      resolveOpencodeBaseImage(root, { OPENCODE_BASE_IMAGE: 'override/base:2' }),
      'override/base:2',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('checkBuildToolchain is a no-op off Windows and the gate only applies to hybrid+win32', () => {
  if (process.platform !== 'win32') {
    assert.equal(checkBuildToolchain(), null)
  }
  // The converge gate never runs off Windows, and never in docker mode.
  assert.equal(buildToolchainStep.appliesTo({ mode: 'hybrid' }), process.platform === 'win32')
  assert.equal(buildToolchainStep.appliesTo({ mode: 'docker' }), false)
})

test('buildToolchainStep warns instead of blocking when the workspace install already converged', async () => {
  const repo = makeFakeRepo()
  const missingToolchain = () => ({ level: 'fail', guide: ['install VC++'] })
  const ctx = { repoRoot: repo, log: () => {}, checkBuildToolchainImpl: missingToolchain }

  // No node_modules, no install marker: an install is pending — hard block.
  await assert.rejects(() => buildToolchainStep.check(ctx), (error) => error instanceof StepBlocked)

  // Converged workspace (node_modules + matching install.hash): warn, no block.
  fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true })
  fs.mkdirSync(path.join(repo, '.mercato', 'starter'), { recursive: true })
  const currentHash = crypto.createHash('sha256')
    .update('yarn.lock').update(Buffer.alloc(0))
    .update('package.json').update(Buffer.alloc(0))
    .digest('hex')
  fs.writeFileSync(path.join(repo, '.mercato', 'starter', 'install.hash'), `${currentHash}\n`)
  const outcome = await buildToolchainStep.check(ctx)
  assert.equal(outcome.ok, true)
  assert.match(outcome.detail, /already converged/)

  // A pending lockfile change re-arms the hard block.
  fs.writeFileSync(path.join(repo, 'yarn.lock'), 'changed\n')
  await assert.rejects(() => buildToolchainStep.check(ctx), (error) => error instanceof StepBlocked)
})
