import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const SUPERVISOR_FILES = [
  'scripts/dev.mjs',
  'packages/create-app/template/scripts/dev.mjs',
]

const APP_RUNTIME_FILES = [
  'apps/mercato/scripts/dev.mjs',
  'packages/create-app/template/scripts/dev-runtime.mjs',
]

function read(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
}

for (const relPath of SUPERVISOR_FILES) {
  test(`${relPath} defaults to the direct topology`, () => {
    const source = read(relPath)
    assert.match(source, /const gatewayMode = devRuntimeConfig\.mode === 'proxy'/)
    assert.match(source, /if \(!gatewayMode\) return true/)
  })

  test(`${relPath} keeps the supervisor alive after a stage failure only in gateway mode`, () => {
    const source = read(relPath)
    assert.match(source, /function keepSupervisorAliveAfterStageFailure\(label\) \{\s*\n\s*if \(!gatewayMode \|\| shuttingDown\) return false/)
    assert.match(source, /if \(keepSupervisorAliveAfterStageFailure\(label\)\) return\s*\n\s*shutdown\(code \?\? 1\)/)
  })

  // Surviving a stage failure means the gateway keeps serving, NOT that startup
  // keeps going: `reportStageFailure` returns to its caller, so without a latch
  // the remaining stages and the app launch would run against a tree that is
  // already known to be broken.
  test(`${relPath} stops the startup pipeline when a stage failure spares the supervisor`, () => {
    const source = read(relPath)
    assert.match(source, /function keepSupervisorAliveAfterStageFailure\(label\) \{[\s\S]*?startupAborted = true/)
    for (const guarded of [
      'async function runStage(label, commandArgs, options = {}) {',
      'async function runPassthroughStage(label, commandArgs, options = {}) {',
      'function startPackageWatch() {',
      'function launchMonorepoAppDev() {',
      'function launchStandaloneDev(options = {}) {',
    ]) {
      const index = source.indexOf(guarded)
      assert.notEqual(index, -1, `missing ${guarded}`)
      assert.match(source.slice(index, index + guarded.length + 40), /\n\s*if \(startupAborted\) return/, guarded)
    }
    // A recovery action is the deliberate answer to that failure, so it clears
    // the latch instead of being blocked by it.
    assert.match(source, /function relaunchManagedRuntime\(reason\) \{[\s\S]*?startupAborted = false/)
  })

  test(`${relPath} keeps the supervisor alive after a managed runtime exit only in gateway mode`, () => {
    const source = read(relPath)
    assert.match(source, /function keepSupervisorAliveAfterFailure\(\) \{\s*\n\s*if \(!gatewayMode \|\| shuttingDown\) return false/)
  })

  test(`${relPath} binds the managed runtime to the internal port only in gateway mode`, () => {
    const source = read(relPath)
    assert.match(source, /gatewayMode && devUpstreamPort \? \{ PORT: String\(devUpstreamPort\) \}/)
  })

  test(`${relPath} probes the managed runtime directly rather than through the gateway`, () => {
    const source = read(relPath)
    assert.match(source, /function resolveRuntimeProbeBaseUrl\(\)/)
    assert.match(source, /if \(gatewayMode && devUpstreamPort\) return `http:\/\/127\.0\.0\.1:\$\{devUpstreamPort\}`/)
  })

  test(`${relPath} fails clearly on a public port collision instead of moving the gateway`, () => {
    const source = read(relPath)
    assert.match(source, /error\?\.code === 'EADDRINUSE'/)
    assert.match(source, /Free the port, choose another PORT, or set OM_DEV_RUNTIME_MODE=direct\./)
    assert.doesNotMatch(source, /devGateway\.listen\(0,/)
  })

  test(`${relPath} exposes only the fixed recovery allowlist to the gateway`, () => {
    const source = read(relPath)
    const handlerBlock = source.slice(source.indexOf('const devRuntimeActions'), source.indexOf('const codingFlow'))
    assert.match(handlerBlock, /state: devRuntime,/)
    assert.match(handlerBlock, /generate: async \(\) =>/)
    assert.match(handlerBlock, /migrate: async \(\) =>/)
    assert.match(handlerBlock, /restart: async \(\) =>/)
    // Commands are literal argument arrays; nothing is built from request input.
    assert.match(handlerBlock, /runRecoveryCommand\('Regenerating module artifacts', \['generate'\]\)/)
    assert.match(handlerBlock, /runRecoveryCommand\('Applying database migrations', \['db:migrate'\]\)/)
  })

  test(`${relPath} guards the additive splash recovery endpoint`, () => {
    const source = read(relPath)
    const block = source.slice(
      source.indexOf("if (req.method === 'POST' && req.url.startsWith('/runtime/actions/'))"),
      source.indexOf("if (req.url.startsWith('/runtime/logs'))"),
    )
    assert.match(block, /assertLocalSplashRequest\(req, process\.env\)/)
    assert.match(block, /if \(!devRuntime\.enabled\)/)
    assert.match(block, /isMatchingDevRuntimeToken\(devRuntime\.token, req\.headers\['x-om-dev-runtime-token'\]\)/)
    assert.match(block, /await devRuntimeActions\.run\(action\)/)
  })

  test(`${relPath} clears child state before opening each runtime generation`, () => {
    const source = read(relPath)

    for (const launcher of [
      'function launchStandaloneDev(options = {}) {',
      'function launchMonorepoAppDev() {',
    ]) {
      const start = source.indexOf(launcher)
      assert.notEqual(start, -1, `missing ${launcher}`)
      const body = source.slice(start, start + 2500)
      const clearIndex = body.indexOf('writeSplashChildStateFileClear()')
      const generationIndex = body.indexOf('devRuntime.beginGeneration(')
      assert.ok(clearIndex >= 0 && clearIndex < generationIndex, `${launcher} must clear stale child state before resetting the ingestion cursor`)
    }
  })

  test(`${relPath} host-guards every additive runtime read or recovery endpoint`, () => {
    const source = read(relPath)
    const statusBlock = source.slice(
      source.indexOf("if (req.url === '/runtime/status')"),
      source.indexOf("if (req.method === 'POST' && req.url.startsWith('/runtime/actions/'))"),
    )
    const logsBlock = source.slice(
      source.indexOf("if (req.url.startsWith('/runtime/logs'))"),
      source.indexOf("if (req.url === '/' || req.url.startsWith('/?'))"),
    )

    assert.match(statusBlock, /assertLocalSplashRequest\(req, process\.env\)/)
    assert.match(logsBlock, /assertLocalSplashRequest\(req, process\.env\)/)
  })

  test(`${relPath} keeps the existing splash status contract intact`, () => {
    const source = read(relPath)
    assert.match(source, /if \(req\.url === '\/status'\) \{/)
    assert.match(source, /await gitRepoFlow\.enrichState\(mergedState/)
  })

  test(`${relPath} tears the gateway down with the splash server`, () => {
    const source = read(relPath)
    assert.match(source, /function closeSplashServer\(\) \{[\s\S]*?closeDevRuntimeGateway\(\)[\s\S]*?devRuntime\.stop\(\)/)
  })

  test(`${relPath} never leaks the child's raw signal channel into the splash payload`, () => {
    const source = read(relPath)
    assert.match(source, /const \{ runtimeSignals: _ignoredChildSignals, \.\.\.childDisplayState \} = childState \?\? \{\}/)
  })

  test(`${relPath} lets the structured runtime state drive ready and failed`, () => {
    const source = read(relPath)
    assert.match(source, /\{ runtime: runtimeStatus, ready: runtimeStatus\.ready, failed: runtimeStatus\.failed \}/)
  })
}

for (const relPath of APP_RUNTIME_FILES) {
  test(`${relPath} emits typed runtime signals for the collector`, () => {
    const source = read(relPath)
    assert.match(source, /function emitRuntimeSignal\(signal\)/)
    assert.match(source, /source: options\.source \?\? 'log'/)
    assert.match(source, /source: 'process',\s*\n\s*failureStage: result\?\.label,/)
    assert.match(source, /source: 'warmup',\s*\n\s*failureStage: 'Startup warmup',/)
  })

  test(`${relPath} bounds the buffered runtime signal channel`, () => {
    const source = read(relPath)
    assert.match(source, /while \(splashState\.runtimeSignals\.length > maxBufferedRuntimeSignals\)/)
  })

  test(`${relPath} stays silent when no supervisor state file was provided`, () => {
    const source = read(relPath)
    assert.match(source, /function emitRuntimeSignal\(signal\) \{\s*\n\s*if \(!splashChildStateFile\) return/)
  })
}

// Next.js treats a leading-underscore folder as a private folder and drops it
// from the route tree, so a `__open-mercato` folder silently falls through to
// the module catch-all (which answers `{"error":"Not Found"}` — found in manual
// QA). The routes therefore live under a plain kebab-case segment, which also
// cannot collide with a module's snake_case `/api/<module_id>/...` routes.
for (const appRoot of ['apps/mercato/src/app/api', 'packages/create-app/template/src/app/api']) {
  test(`${appRoot} exposes the dev runtime routes under a routable segment`, () => {
    const dir = path.resolve(ROOT, appRoot, 'dev-runtime')
    assert.equal(fs.existsSync(dir), true, `${appRoot}/dev-runtime must exist`)
    for (const route of ['status/route.ts', 'diagnostics/route.ts', 'actions/[action]/route.ts', 'logs/route.ts']) {
      assert.equal(fs.existsSync(path.join(dir, route)), true, `missing ${route}`)
    }
    // A leading underscore (raw or %5F-escaped) is never the answer here.
    for (const rejected of ['__open-mercato', '%5F%5Fopen-mercato', '_open-mercato']) {
      assert.equal(fs.existsSync(path.resolve(ROOT, appRoot, rejected)), false, `${rejected} must not exist`)
    }
  })
}

test('the dev runtime route paths stay in sync with the folders on disk', () => {
  const types = read('packages/shared/src/lib/dev-runtime/types.ts')
  assert.match(types, /DEV_RUNTIME_STATUS_PATH = '\/api\/dev-runtime\/status'/)
  assert.match(types, /DEV_RUNTIME_DIAGNOSTICS_PATH = '\/api\/dev-runtime\/diagnostics'/)
  assert.match(types, /DEV_RUNTIME_ACTIONS_PATH = '\/api\/dev-runtime\/actions'/)
  assert.match(types, /DEV_RUNTIME_LOGS_PATH = '\/api\/dev-runtime\/logs'/)
})

test('the dev runtime server config never keys off NODE_ENV', () => {
  // `mercato dev` spawns Next with NODE_ENV=production
  // (buildServerProcessEnvironment), so NODE_ENV cannot gate dev diagnostics.
  const source = read('packages/shared/src/lib/dev-runtime/server.ts')
  const body = source.slice(source.indexOf('export function resolveDevRuntimeServerConfig'))
  assert.doesNotMatch(body, /env\.NODE_ENV/)
  assert.match(body, /readFlag\(env\.OM_DEV_RUNTIME_DIAGNOSTICS, false\)/)
  assert.match(body, /if \(!token \|\| !statusFilePath \|\| !diagnosticsFilePath\) return DISABLED_CONFIG/)
})

for (const relPath of SUPERVISOR_FILES) {
  // A recovery child that fails to spawn, or that leaves a grandchild holding
  // its stdio pipes, never emits 'close'. Waiting only on 'close' wedged the
  // single-action latch at `recovering` until the action timeout (seen in
  // manual QA after a `migrate` run).
  test(`${relPath} settles a recovery child on exit/error, not only on close`, () => {
    const source = read(relPath)
    assert.match(source, /function waitForRecoveryChildExit\(child\)/)
    const body = source.slice(
      source.indexOf('function waitForRecoveryChildExit'),
      source.indexOf('async function runRecoveryCommand'),
    )
    assert.match(body, /child\.on\('close'/)
    assert.match(body, /child\.on\('exit'/)
    assert.match(body, /child\.on\('error'/)
    // Only the first signal wins, so the latch is released exactly once.
    assert.match(body, /if \(settled\) return/)
    assert.match(source, /await waitForRecoveryChildExit\(child\)/)
  })
}
