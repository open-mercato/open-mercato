import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runStreaming, stopStreamingChild } from '../compose.mjs'
import { STARTER_STATE_DIR } from '../constants.mjs'
import { startInfraServices } from '../infra-preflight.mjs'
import { createSetupLogs } from '../setup-logs.mjs'
import { databaseStep, runSteps, StepBlocked, workspaceBuildStep } from '../steps.mjs'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function stubLogs() {
  const events = []
  const rawLines = []
  const recorded = []
  let active = false
  return {
    events, rawLines, recorded,
    get active() { return active },
    start() { events.push('start'); active = true },
    stop() { events.push('stop'); active = false },
    suspend() { events.push('suspend'); active = false },
    resume() { events.push('resume'); active = true },
    show(reason) { events.push(`show:${reason}`) },
    raw(chunk) { rawLines.push(String(chunk)) },
    log(...args) { rawLines.push(args.join(' ')) },
    record(...args) { recorded.push(args.join(' ')) },
  }
}

function temporaryRepo(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-setup-streaming-'))
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }))
  return repoRoot
}

test('runStreaming captures stdout and stderr while the child runs, then waits for close', async () => {
  const chunks = []
  const firstOutput = deferred()
  let finished = false
  const running = runStreaming(process.execPath, ['-e', "process.stdout.write('build started\\n'); setTimeout(() => { process.stderr.write('build diagnostic\\n'); process.exitCode = 0 }, 80)"], {
    logs: { raw(chunk) { chunks.push(String(chunk)); firstOutput.resolve() } },
  }).then((code) => { finished = true; return code })
  await firstOutput.promise
  assert.equal(finished, false, 'output arrives before the child completes')
  assert.equal(await running, 0)
  assert.match(chunks.join(''), /build started/)
  assert.match(chunks.join(''), /build diagnostic/)
})

test('runStreaming preserves nonzero exits and reports spawn errors', async () => {
  const chunks = []
  const status = await runStreaming(process.execPath, ['-e', "process.stderr.write('failed command\\n'); process.exitCode = 7"], {
    logs: { raw(chunk) { chunks.push(String(chunk)) } },
  })
  assert.equal(status, 7)
  assert.equal(chunks.join(''), 'failed command\n')
  await assert.rejects(runStreaming(path.join(os.tmpdir(), 'mercato-nonexistent-command'), [], { logs: stubLogs() }), /could not be executed/)
})

test('runSteps keeps progress visible, folds routine details, and suspends toggles for prompts', async () => {
  const visible = []
  const originalLog = (...args) => visible.push(args.join(' '))
  const logs = stubLogs()
  const ctx = { log: originalLog, logs, flags: {} }
  const outcome = await runSteps([
    {
      id: 'build', title: 'Build packages',
      async check(context) { context.log('routine build probe'); return { ok: false, detail: 'packages need rebuilding' } },
      async apply(context) { context.log('compiler detail'); assert.equal(logs.active, true); context.installChanged = true },
    },
    {
      id: 'provider', title: 'AI provider', interactive: true,
      async apply(context) { assert.equal(logs.active, false); context.log('Choose a provider:') },
    },
    { id: 'ready', title: 'Ready', async check() { return { ok: true, detail: 'already configured' } } },
  ], ctx)
  assert.deepEqual(outcome, { ok: true })
  assert.match(visible.join('\n'), /Step 1\/3.*Build packages/)
  assert.match(visible.join('\n'), /packages need rebuilding/)
  assert.match(visible.join('\n'), /Choose a provider:/)
  assert.match(visible.join('\n'), /already configured.*skipped/)
  assert.doesNotMatch(visible.join('\n'), /routine build probe|compiler detail/)
  assert.deepEqual(logs.rawLines, ['routine build probe', 'compiler detail'])
  assert.match(logs.recorded.join('\n'), /Step 1\/3.*Build packages/)
  assert.deepEqual(logs.events, ['start', 'suspend', 'resume', 'stop'])
  assert.equal(ctx.log, originalLog)
  assert.equal(ctx.installChanged, true, 'step mutations survive output routing')
  assert.equal(logs.active, false)
})

test('runSteps reveals failure output before diagnostics and always restores the original logger', async () => {
  for (const error of [new Error('compiler failed'), new StepBlocked('build', ['Install the missing prerequisite'])]) {
    const order = []
    const originalLog = (...args) => order.push(args.join(' '))
    const logs = stubLogs()
    logs.show = (reason) => { order.push(`revealed:${reason}`) }
    const ctx = { log: originalLog, logs, flags: {} }
    const outcome = await runSteps([
      { id: 'build', title: 'Build', async apply(context) { context.log('raw failure detail'); throw error } },
      { id: 'later', title: 'Later', async apply() { assert.fail('pipeline must stop after failure') } },
    ], ctx)
    assert.equal(outcome.ok, false)
    assert.equal(outcome[error instanceof StepBlocked ? 'blockedStep' : 'failedStep'], 'build')
    const revealIndex = order.findIndex((line) => line.startsWith('revealed:'))
    const diagnosticIndex = order.findIndex((line) => line.includes(error instanceof StepBlocked ? 'blocked —' : 'compiler failed'))
    assert.ok(revealIndex >= 0 && diagnosticIndex > revealIndex)
    assert.equal(logs.events.at(-1), 'stop')
    assert.equal(ctx.log, originalLog)
  }
})

test('a real log controller releases raw input listeners after both success and failure', async () => {
  for (const fail of [false, true]) {
    const input = new EventEmitter()
    Object.assign(input, {
      isTTY: true, isRaw: false, readableFlowing: false,
      setRawMode(value) { this.isRaw = value },
      resume() { this.readableFlowing = true },
      pause() { this.readableFlowing = false },
    })
    const output = { isTTY: true, columns: 80, write() {} }
    const logs = createSetupLogs({ input, output, env: {} })
    await runSteps([{ id: 'work', title: 'Work', async apply() { if (fail) throw new Error('failed') } }], { logs, log() {}, flags: {} })
    assert.equal(input.listenerCount('data'), 0)
    assert.equal(input.isRaw, false)
    assert.equal(input.readableFlowing, false)
  }
})

test('workspace build awaits each async command and stops before generation on failure', async () => {
  const firstBuild = deferred()
  const invoked = []
  const ctx = { runYarnImpl: async (_ctx, args) => { invoked.push(args[0]); if (invoked.length === 1) await firstBuild.promise } }
  const running = workspaceBuildStep.apply(ctx)
  assert.deepEqual(invoked, ['build:packages'])
  firstBuild.resolve()
  await running
  assert.deepEqual(invoked, ['build:packages', 'generate', 'build:packages'])

  const failed = []
  await assert.rejects(workspaceBuildStep.apply({ runYarnImpl: async (_ctx, args) => { failed.push(args[0]); throw new Error('build broke') } }), /build broke/)
  assert.deepEqual(failed, ['build:packages'])
})

test('database setup does not mark pending or failed migrations as complete', async (t) => {
  const repoRoot = temporaryRepo(t)
  const migration = deferred()
  const invocations = []
  const ctx = {
    repoRoot, env: {}, flags: { noInfra: true }, log() {},
    dbMigrationsMarker: 'db-migrations-test', dbMarker: 'db-initialized-test', migrationsFingerprint: 'fingerprint',
    runStreamingImpl: async (_command, args) => { invocations.push(args[0]); return migration.promise },
  }
  const migrationsFile = path.join(repoRoot, STARTER_STATE_DIR, ctx.dbMigrationsMarker)
  const initializedFile = path.join(repoRoot, STARTER_STATE_DIR, ctx.dbMarker)
  const running = databaseStep.apply(ctx)
  assert.equal(fs.existsSync(migrationsFile), false)
  assert.equal(fs.existsSync(initializedFile), false)
  migration.resolve(2)
  await assert.rejects(running, /db:migrate failed \(exit 2\)/)
  assert.deepEqual(invocations, ['db:migrate'])
  assert.equal(fs.existsSync(migrationsFile), false)
  assert.equal(fs.existsSync(initializedFile), false)
})

test('database setup records successful migration but never a failed initialization', async (t) => {
  const repoRoot = temporaryRepo(t)
  const ctx = {
    repoRoot, env: {}, flags: { noInfra: true }, log() {},
    dbMigrationsMarker: 'db-migrations-test', dbMarker: 'db-initialized-test', migrationsFingerprint: 'fingerprint',
    runStreamingImpl: async (_command, args) => args[0] === 'db:migrate' ? 0 : 3,
  }
  await assert.rejects(databaseStep.apply(ctx), /initialize.*failed \(exit 3\)/)
  assert.equal(fs.readFileSync(path.join(repoRoot, STARTER_STATE_DIR, ctx.dbMigrationsMarker), 'utf8'), 'fingerprint\n')
  assert.equal(fs.existsSync(path.join(repoRoot, STARTER_STATE_DIR, ctx.dbMarker)), false)
})

test('infrastructure awaits asynchronous image preparation before streaming compose up', async () => {
  const preparation = deferred()
  const order = []
  const services = [{ service: 'postgres', port: 5432, envKey: 'POSTGRES_PORT' }]
  const running = startInfraServices({
    composeArgs: (args) => ['compose', ...args], services, cwd: '/repo',
    detect: () => ({ ok: true }), portProbe: async () => false, log() {},
    spawnSyncImpl: (_command, args) => {
      assert.ok(args.includes('ps'), 'sync runner is only used for short probes')
      return { status: 0, stdout: '[]' }
    },
    beforeUp: async () => { order.push('prepare:start'); await preparation.promise; order.push('prepare:done') },
    runStreamingImpl: async (command, args, options) => {
      order.push('compose:up')
      assert.equal(command, 'docker')
      assert.deepEqual(args, ['compose', 'up', '-d', '--wait'])
      assert.equal(options.cwd, '/repo')
      return { status: 0 }
    },
  })
  // The port check yields before image preparation begins.
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ['prepare:start'])
  preparation.resolve()
  assert.deepEqual(await running, { ok: true, reused: [] })
  assert.deepEqual(order, ['prepare:start', 'prepare:done', 'compose:up'])
})

test('d reveals logs while a real child is still running', async () => {
  const input = new EventEmitter()
  Object.assign(input, {
    isTTY: true, isRaw: false, readableFlowing: false,
    setRawMode(value) { this.isRaw = value },
    resume() { this.readableFlowing = true },
    pause() { this.readableFlowing = false },
  })
  const output = []
  const logs = createSetupLogs({ input, output: { isTTY: true, columns: 80, write(chunk) { output.push(String(chunk)) } }, env: {} })
  const firstOutput = deferred()
  let finished = false
  logs.start()
  try {
    const running = runStreaming(process.execPath, ['-e', "process.stdout.write('migration started\\n'); setTimeout(() => process.stdout.write('migration done\\n'), 80)"], {
      logs: { raw(chunk) { logs.raw(chunk); firstOutput.resolve() } },
    }).then((code) => { finished = true; return code })
    await firstOutput.promise
    assert.equal(finished, false)
    assert.doesNotMatch(output.join(''), /migration started/)
    input.emit('data', 'd')
    assert.match(output.join(''), /migration started/)
    assert.equal(await running, 0)
    assert.match(output.join(''), /migration done/)
  } finally {
    logs.stop()
  }
})

test('async infrastructure failure retains unhealthy service guidance', async () => {
  let listed = 0
  const outcome = await startInfraServices({
    composeArgs: (args) => ['compose', ...args],
    services: [{ service: 'postgres', port: 5432, envKey: 'POSTGRES_PORT' }],
    detect: () => ({ ok: true }), portProbe: async () => false, log() {},
    spawnSyncImpl: () => ({ status: 0, stdout: ++listed === 1 ? '[]' : JSON.stringify([{ Service: 'postgres', State: 'running', Health: 'unhealthy' }]) }),
    runStreamingImpl: async () => ({ status: 1 }),
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.problem.code, 'unhealthy')
  assert.equal(outcome.problem.services[0].service, 'postgres')
  assert.equal(outcome.problem.logsCommand, 'docker compose logs postgres')
})


test('streamed children inherit stdin outside compact mode and release signal listeners', async () => {
  const before = ['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name))
  for (const interactive of [true, false]) {
    let options
    const child = new EventEmitter()
    const running = runStreaming(process.execPath, [], {
      logs: { interactive, raw() {} },
      spawnImpl(_command, _args, passed) { options = passed; queueMicrotask(() => child.emit('close', 0)); return child },
    })
    assert.equal(options.stdio[0], interactive ? 'ignore' : 'inherit')
    assert.equal(await running, 0)
  }
  assert.deepEqual(['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name)), before)
})

test('interrupts stop the Windows child tree and POSIX process group, with a child fallback', () => {
  const calls = []
  const child = { pid: 12345, kill: (signal) => calls.push(['child', signal]) }
  stopStreamingChild(child, 'SIGINT', { platform: 'win32', spawnSyncImpl(command, args, options) {
    calls.push([command, args, options.windowsHide]); return { status: 0 }
  } })
  assert.deepEqual(calls, [['taskkill', ['/pid', '12345', '/T', '/F'], true]])
  calls.length = 0
  stopStreamingChild(child, 'SIGTERM', { platform: 'linux', killImpl: (pid, signal) => calls.push([pid, signal]) })
  assert.deepEqual(calls, [[-12345, 'SIGTERM']])
  calls.length = 0
  stopStreamingChild(child, 'SIGINT', { platform: 'win32', spawnSyncImpl: () => ({ status: 1 }) })
  assert.deepEqual(calls, [['child', 'SIGINT']])
})


test('infra CLI saves actionable preflight diagnostics even when no child produces logs', (t) => {
  const repoRoot = temporaryRepo(t)
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'open-mercato' }))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)), 'infra', 'up'], {
    cwd: repoRoot,
    env: { ...process.env, PATH: repoRoot, OM_DEV_RUN_ID: 'preflight', OM_DEV_LOG_DIR: '.mercato/logs', OM_DEV_LOG_TEE: '1' },
    encoding: 'utf8', timeout: 10000,
  })
  assert.equal(result.status, 2, result.stderr)
  const file = path.join(repoRoot, '.mercato', 'logs', 'preflight-infra-raw.log')
  const saved = fs.readFileSync(file, 'utf8')
  assert.match(result.stdout, /Verbose logs.*preflight-infra-raw.log/)
  assert.match(saved, /Docker CLI.*not found|docker.*not found/i)
  assert.match(saved, /yarn om doctor/)
})
