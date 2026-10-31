import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import vm from 'node:vm'
import ts from 'typescript-js'
import { resolveEphemeralSuperadminPassword } from '../../packages/cli/src/lib/testing/bootstrap-password.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = fs.readFileSync(path.join(repoRoot, 'scripts/dev-ephemeral.ts'), 'utf8')
const sourceFile = ts.createSourceFile('dev-ephemeral.ts', source, ts.ScriptTarget.Latest, true)
const functions = sourceFile.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && ['main', 'startDevServer'].includes(statement.name?.text))
  .map((statement) => statement.getText(sourceFile))
  .join('\n')
assert.equal(functions.match(/async function /g)?.length, 2)
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

for (const scenario of [
  { name: 'generated credential', environment: {}, envFile: '' },
  { name: 'app environment credential', environment: {}, envFile: 'OM_INIT_SUPERADMIN_PASSWORD=FromFile-8wQ!t3rZ' },
  { name: 'shell credential override', environment: { OM_INIT_SUPERADMIN_PASSWORD: 'FromShell-7qW!t2rZ' }, envFile: 'OM_INIT_SUPERADMIN_PASSWORD=FromFile-8wQ!t3rZ' },
]) {
  test(`ephemeral dev forwards the same ${scenario.name} to initialization and runtime warmup`, async () => {
    let initializePassword
    let runtimePassword
    let runtimeSession
    let exitCode
    const sandbox = {
      process: { env: scenario.environment, cwd: () => '/tmp/test-app' },
      path,
      parseEnv,
      resolveEphemeralSuperadminPassword,
      readFile: async () => scenario.envFile,
      mkdir: async () => {},
      ensureEnvFile: async () => {},
      startSplashServer: async () => {},
      assertNode24Runtime: () => {},
      shutdownController: { installSignalHandlers() {}, setActiveContainerId() {}, setActiveChild() {} },
      devSession: { childEnv: { OM_DEV_SESSION_ID: 'test-session' }, registerChild() {} },
      runCompactStage: async (_label, _command, args, options) => {
        if (args[0] === 'initialize') initializePassword = options.env.OM_INIT_SUPERADMIN_PASSWORD
        return 0
      },
      pruneStaleDevInstances: async () => {},
      resolvePort: async () => 5009,
      updateSplashState: () => {},
      startEphemeralPostgres: async () => ({ containerId: 'test-container', databaseUrl: 'postgres://localhost/test', postgresPort: 5432 }),
      resolveDevBaseUrl: (_environment, options) => ({ url: `http://127.0.0.1:${options.actualPort}` }),
      envPath: '/tmp/test-app/.env',
      projectRootDirectory: '/tmp/test-app',
      warmupReadyFilePath: '/tmp/test-app/warmup-ready',
      splashChildStateFilePath: '/tmp/test-app/splash-state',
      autoOpenSplash: true,
      classic: false,
      verbose: false,
      spawn: (_command, _args, options) => {
        runtimePassword = options.env.OM_INIT_SUPERADMIN_PASSWORD
        runtimeSession = options.env.OM_DEV_SESSION_ID
        const child = new EventEmitter()
        child.pid = 1234
        setImmediate(() => child.emit('exit', 0))
        return child
      },
      registerCurrentDevInstance: async () => {},
      unregisterCurrentDevInstance: async () => {},
      stopPostgresContainer: async () => {},
      closeSplashServer: () => {},
      waitForDevServerReady: async () => true,
      redactPostgresUrl: () => '<redacted>',
      shutdown: async (code) => { exitCode = code },
      waitForSplashFailureRender: async () => {},
      console: { log() {}, error() {} },
    }

    await vm.runInNewContext(`${compiled}\nmain()`, sandbox)

    assert.equal(exitCode, 0)
    assert.equal(typeof initializePassword, 'string')
    assert.ok(initializePassword.length > 0)
    assert.equal(runtimePassword, initializePassword)
    assert.equal(runtimeSession, 'test-session')
    const expectedPassword = scenario.environment.OM_INIT_SUPERADMIN_PASSWORD ?? parseEnv(scenario.envFile).OM_INIT_SUPERADMIN_PASSWORD
    if (expectedPassword) assert.equal(initializePassword, expectedPassword)
  })
}
