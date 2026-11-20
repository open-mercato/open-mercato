import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const devFiles = ['scripts/dev.mjs', 'packages/create-app/template/scripts/dev.mjs']

function functionText(source, name) {
  const start = source.indexOf(`async function ${name}(`)
  assert.notEqual(start, -1, `${name} is present`)
  const end = source.indexOf('\n}', start)
  assert.notEqual(end, -1, `${name} has a complete body`)
  return source.slice(start, end + 2)
}

function testContext(source, overrides = {}) {
  const context = {
    path,
    process: { cwd: () => '/workspace', env: { DATABASE_URL: 'postgres://from-shell/db', KEEP: 'value' } },
    args: [],
    assertEncryptionCompatible: async ({ env }) => ({ status: 'verified', settings: env }),
    isMonorepo: false,
    startupAborted: false,
    verbose: true,
    splashState: { progressCurrent: 0 },
    yarnCommand: 'yarn',
    getDevRunnerLog: () => null,
    classifyStageMarker() {},
    markMemoryTrace() {},
    formatProgressLine: () => '',
    resolveProgressPercent: () => 0,
    updateSplashState() {},
    console: { log() {}, warn() {} },
    shouldAutoMigrateOnDev: () => true,
    ...overrides,
  }
  vm.createContext(context)
  vm.runInContext(`${functionText(source, 'guardDatabaseMutation')};`, context)
  return context
}

for (const file of devFiles) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8')

  for (const launcher of ['runRawYarnCommand', 'runPassthroughStage', 'runRecoveryCommand', 'applyPendingMigrationsBestEffort']) {
    test(`${file}: ${launcher} rejects unacknowledged remote writes before spawning`, async () => {
      let spawned = false
      let checked = false
      const context = testContext(source, {
        async assertDatabaseWriteAllowed() { checked = true; throw new Error('Remote database acknowledgment required') },
        spawnCommand() { spawned = true; throw new Error('must not spawn') },
      })
      const run = vm.runInContext(`(${functionText(source, launcher)})`, context)
      const argumentsForLauncher = launcher === 'runRawYarnCommand' ? [['db:migrate']]
        : launcher === 'applyPendingMigrationsBestEffort' ? []
          : ['Applying migrations', ['db:migrate']]
      await assert.rejects(run(...argumentsForLauncher), /Remote database acknowledgment required/)
      assert.equal(checked, true)
      assert.equal(spawned, false)
    })
  }

  for (const launcher of ['runRawYarnCommand', 'runPassthroughStage', 'runRecoveryCommand', 'applyPendingMigrationsBestEffort', 'provisionMcpApiKey']) {
    test(`${file}: ${launcher} rejects incompatible encryption before any mutation child`, async () => {
      let spawned = false
      const order = []
      const context = testContext(source, {
        async assertDatabaseWriteAllowed() { order.push('remote'); return { remote: false } },
        async assertEncryptionCompatible() { order.push('encryption'); throw Object.assign(new Error('Encryption compatibility rejected'), { name: 'EncryptionCompatibilityError' }) },
        spawnCommand() { spawned = true; throw new Error('must not spawn') },
        spawnMcpCommand() { spawned = true; throw new Error('must not spawn') },
      })
      const run = vm.runInContext(`(${functionText(source, launcher)})`, context)
      const argumentsForLauncher = launcher === 'runRawYarnCommand' ? [['initialize', '--reinstall']]
        : ['applyPendingMigrationsBestEffort', 'provisionMcpApiKey'].includes(launcher) ? []
          : ['Applying migrations', ['db:migrate']]
      if (launcher === 'applyPendingMigrationsBestEffort') await run(...argumentsForLauncher)
      else await assert.rejects(run(...argumentsForLauncher), /Encryption compatibility rejected/)
      assert.deepEqual(order, ['remote', 'encryption'])
      assert.equal(spawned, false)
    })
  }

  test(`${file}: initialization guard inspects the exact child environment after database overrides`, async () => {
    let request
    const context = testContext(source, {
      isMonorepo: true,
      async assertDatabaseWriteAllowed(options) {
        request = options
        return { remote: true, target: 'db.example:5432/client_db', argument: '--allow-remote-database=db.example:5432/client_db' }
      },
    })
    await context.guardDatabaseMutation(['initialize', '--reinstall'], { DATABASE_URL: 'postgres://db.example/client_db' })
    assert.equal(request.projectDir, path.join('/workspace', 'apps', 'mercato'))
    assert.equal(request.env.DATABASE_URL, 'postgres://db.example/client_db')
    assert.equal(request.env.KEEP, 'value')
    assert.equal(context.args[0], '--allow-remote-database=db.example:5432/client_db')
  })

  test(`${file}: ordinary builds and disabled automatic migrations need no write acknowledgment`, async () => {
    let checked = false
    const context = testContext(source, {
      async assertDatabaseWriteAllowed() { checked = true; throw new Error('must not check') },
      shouldAutoMigrateOnDev: () => false,
      spawnCommand() { throw new Error('must not spawn') },
    })
    await context.guardDatabaseMutation(['build:packages'])
    await context.guardDatabaseMutation(['generate'])
    const migrate = vm.runInContext(`(${functionText(source, 'applyPendingMigrationsBestEffort')})`, context)
    await migrate()
    assert.equal(checked, false)
  })

  test(`${file}: acknowledged database writes reach the mutation launcher`, async () => {
    let checked = false
    let spawned = false
    const context = testContext(source, {
      async assertDatabaseWriteAllowed() { checked = true; return { remote: false } },
      spawnCommand() { spawned = true; throw new Error('spawn reached') },
    })
    const run = vm.runInContext(`(${functionText(source, 'runRawYarnCommand')})`, context)
    await assert.rejects(run(['initialize']), /spawn reached/)
    assert.equal(checked, true)
    assert.equal(spawned, true)
  })
}

test('root and template dev mutation boundaries remain byte-identical', () => {
  assert.equal(fs.readFileSync(path.join(repoRoot, devFiles[0]), 'utf8'), fs.readFileSync(path.join(repoRoot, devFiles[1]), 'utf8'))
})
