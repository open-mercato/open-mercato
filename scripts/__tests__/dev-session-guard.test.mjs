import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { acquireDevSession, DevSessionConflictError } from '../dev-session-guard.mjs'

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-session-'))
}

test('acquireDevSession rejects a second owner before it can mutate shared resources', () => {
  const workspaceRoot = createWorkspace()
  const first = acquireDevSession({ workspaceRoot, mode: 'dev', url: 'http://localhost:3000' })

  try {
    assert.throws(
      () => acquireDevSession({ workspaceRoot, mode: 'greenfield', url: 'http://localhost:3002' }),
      (error) => {
        assert.ok(error instanceof DevSessionConflictError)
        assert.match(error.message, new RegExp(`PID ${process.pid}`))
        assert.match(error.message, /mode dev/)
        assert.match(error.message, /http:\/\/localhost:3000/)
        assert.match(error.message, /stopped before build artifacts/)
        return true
      },
    )
  } finally {
    first.release()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('simultaneous launchers cannot both acquire workspace ownership', async () => {
  const workspaceRoot = createWorkspace()
  const guardUrl = new URL('../dev-session-guard.mjs', import.meta.url).href
  const startAt = Date.now() + 300
  const program = `
    import { acquireDevSession } from ${JSON.stringify(guardUrl)}
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, ${startAt} - Date.now())))
    try {
      const session = acquireDevSession({ workspaceRoot: ${JSON.stringify(workspaceRoot)}, mode: 'race' })
      console.log('acquired')
      await new Promise((resolve) => setTimeout(resolve, 750))
      session.release()
    } catch (error) {
      console.log(error?.name === 'DevSessionConflictError' ? 'conflict' : 'unexpected')
      if (error?.name !== 'DevSessionConflictError') process.exitCode = 1
    }
  `

  const runLauncher = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', program], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr }))
  })

  try {
    const results = await Promise.all([runLauncher(), runLauncher()])
    assert.deepEqual(results.map((result) => result.code), [0, 0])
    assert.deepEqual(results.map((result) => result.stdout).sort(), ['acquired', 'conflict'])
    assert.deepEqual(results.map((result) => result.stderr), ['', ''])
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('acquireDevSession lets managed children join the owning session token', () => {
  const workspaceRoot = createWorkspace()
  const owner = acquireDevSession({ workspaceRoot, mode: 'dev' })
  const child = acquireDevSession({
    workspaceRoot,
    mode: 'app-runtime',
    token: owner.token,
    role: 'app-runtime',
  })

  try {
    assert.equal(child.token, owner.token)
    child.release()
    assert.throws(() => acquireDevSession({ workspaceRoot, mode: 'greenfield' }), DevSessionConflictError)
  } finally {
    owner.release()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('acquireDevSession canonicalizes symlinked workspace paths', (context) => {
  if (process.platform === 'win32') {
    context.skip('symlink creation requires elevated privileges on some Windows hosts')
    return
  }

  const workspaceRoot = createWorkspace()
  const linkRoot = `${workspaceRoot}-link`
  fs.symlinkSync(workspaceRoot, linkRoot, 'dir')
  const owner = acquireDevSession({ workspaceRoot, mode: 'dev' })

  try {
    assert.throws(() => acquireDevSession({ workspaceRoot: linkRoot, mode: 'greenfield' }), DevSessionConflictError)
  } finally {
    owner.release()
    fs.rmSync(linkRoot, { force: true })
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('acquireDevSession recovers an owner record whose processes are gone', () => {
  const workspaceRoot = createWorkspace()
  const lockDirectory = path.join(workspaceRoot, '.mercato', 'dev-session.lock')
  fs.mkdirSync(path.join(lockDirectory, 'members'), { recursive: true })
  fs.writeFileSync(path.join(lockDirectory, 'owner.json'), `${JSON.stringify({
    version: 1,
    token: 'stale-token',
    pid: 2_147_483_647,
    mode: 'dev',
    url: 'http://localhost:3000',
    workspaceRoot,
    startedAt: '2026-01-01T00:00:00.000Z',
  })}\n`)

  const recovered = acquireDevSession({ workspaceRoot, mode: 'greenfield' })
  try {
    assert.notEqual(recovered.token, 'stale-token')
  } finally {
    recovered.release()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('acquireDevSession keeps ownership while a recorded child remains alive', () => {
  const workspaceRoot = createWorkspace()
  const lockDirectory = path.join(workspaceRoot, '.mercato', 'dev-session.lock')
  const membersDirectory = path.join(lockDirectory, 'members')
  fs.mkdirSync(membersDirectory, { recursive: true })
  const owner = {
    version: 1,
    token: 'surviving-child-token',
    pid: 2_147_483_647,
    mode: 'dev',
    url: 'http://localhost:3000',
    workspaceRoot,
    startedAt: '2026-01-01T00:00:00.000Z',
  }
  fs.writeFileSync(path.join(lockDirectory, 'owner.json'), `${JSON.stringify(owner)}\n`)
  fs.writeFileSync(path.join(membersDirectory, `${process.pid}.json`), `${JSON.stringify({
    pid: process.pid,
    role: 'app-runtime',
    token: owner.token,
    heartbeatAt: new Date().toISOString(),
  })}\n`)

  try {
    assert.throws(() => acquireDevSession({ workspaceRoot, mode: 'greenfield' }), DevSessionConflictError)
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('owner release transfers workspace protection to a surviving managed child', async () => {
  const workspaceRoot = createWorkspace()
  const owner = acquireDevSession({ workspaceRoot, mode: 'dev' })
  const child = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'], {
    stdio: 'ignore',
  })
  owner.registerChild(child, 'app-runtime')

  try {
    owner.release()
    assert.throws(
      () => acquireDevSession({ workspaceRoot, mode: 'greenfield' }),
      DevSessionConflictError,
    )

    const childClosed = new Promise((resolve) => child.once('close', resolve))
    child.kill('SIGTERM')
    await childClosed

    const recovered = acquireDevSession({ workspaceRoot, mode: 'greenfield' })
    recovered.release()
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('a rejected launch preserves active runtime manifests and compiler cache', () => {
  const workspaceRoot = createWorkspace()
  const routeManifest = path.join(workspaceRoot, 'apps', 'mercato', '.mercato', 'next', 'dev', 'routes-manifest.json')
  const compilerCache = path.join(workspaceRoot, 'apps', 'mercato', '.mercato', 'next', 'cache', 'turbopack.bin')
  fs.mkdirSync(path.dirname(routeManifest), { recursive: true })
  fs.mkdirSync(path.dirname(compilerCache), { recursive: true })
  fs.writeFileSync(routeManifest, '{"active":true}\n')
  fs.writeFileSync(compilerCache, 'compiler-cache')
  const owner = acquireDevSession({ workspaceRoot, mode: 'dev', url: 'http://localhost:3000' })

  try {
    assert.throws(
      () => acquireDevSession({ workspaceRoot, mode: 'greenfield', url: 'http://localhost:4123' }),
      DevSessionConflictError,
    )
    assert.equal(fs.readFileSync(routeManifest, 'utf8'), '{"active":true}\n')
    assert.equal(fs.readFileSync(compilerCache, 'utf8'), 'compiler-cache')
  } finally {
    owner.release()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('all mutable dev entry points acquire ownership before startup work', () => {
  const rootDev = fs.readFileSync(new URL('../dev.mjs', import.meta.url), 'utf8')
  const templateDev = fs.readFileSync(new URL('../../packages/create-app/template/scripts/dev.mjs', import.meta.url), 'utf8')
  const appRuntime = fs.readFileSync(new URL('../../apps/mercato/scripts/dev.mjs', import.meta.url), 'utf8')
  const templateRuntime = fs.readFileSync(new URL('../../packages/create-app/template/scripts/dev-runtime.mjs', import.meta.url), 'utf8')
  const ephemeral = fs.readFileSync(new URL('../dev-ephemeral.ts', import.meta.url), 'utf8')

  for (const source of [rootDev, templateDev]) {
    const acquireIndex = source.indexOf('devSession = acquireDevSession({')
    assert.ok(acquireIndex > 0)
    assert.ok(acquireIndex < source.indexOf('memoryTrace?.start()'))
    assert.ok(acquireIndex < source.indexOf('await main()'))
  }
  for (const source of [appRuntime, templateRuntime]) {
    const acquireIndex = source.indexOf('devSession = acquireDevSession({')
    assert.ok(acquireIndex > 0)
    assert.ok(acquireIndex < source.indexOf('\nclearWarmupReadyFile()'))
    assert.ok(acquireIndex < source.indexOf('await runInitialGenerate()'))
  }
  const ephemeralAcquire = ephemeral.indexOf('devSession = acquireDevSession({')
  const ephemeralMain = ephemeral.indexOf('async function main()')
  assert.ok(ephemeralAcquire > 0 && ephemeralAcquire < ephemeralMain)
  assert.ok(ephemeral.indexOf('await startSplashServer()', ephemeralMain) > ephemeralAcquire)
  assert.ok(ephemeral.indexOf("runCompactStage('Installing dependencies'", ephemeralMain) > ephemeralAcquire)
})

test('root and standalone guard implementations remain byte-identical', () => {
  const rootGuard = fs.readFileSync(new URL('../dev-session-guard.mjs', import.meta.url), 'utf8')
  const templateGuard = fs.readFileSync(new URL('../../packages/create-app/template/scripts/dev-session-guard.mjs', import.meta.url), 'utf8')
  assert.equal(templateGuard, rootGuard)
})

test('session acquisition removes its short-lived gate after success and conflict', () => {
  const workspaceRoot = createWorkspace()
  const stateDirectory = path.join(workspaceRoot, '.mercato')
  const owner = acquireDevSession({ workspaceRoot })
  try {
    assert.deepEqual(fs.readdirSync(stateDirectory), ['dev-session.lock'])
    assert.throws(() => acquireDevSession({ workspaceRoot }), DevSessionConflictError)
    assert.deepEqual(fs.readdirSync(stateDirectory), ['dev-session.lock'])
  } finally {
    owner.release()
    assert.deepEqual(fs.readdirSync(stateDirectory), [])
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('session acquisition recovers a dead gate and retains its generation tombstone', () => {
  const workspaceRoot = createWorkspace()
  const stateDirectory = path.join(workspaceRoot, '.mercato')
  const gateDirectory = path.join(stateDirectory, 'dev-session-acquire.lock')
  const token = '11111111-1111-4111-8111-111111111111'
  fs.mkdirSync(gateDirectory, { recursive: true })
  fs.writeFileSync(path.join(gateDirectory, 'owner.json'), JSON.stringify({ pid: 2_147_483_647, token }))
  const generation = fs.statSync(gateDirectory, { bigint: true })
  const tombstone = path.join(stateDirectory, `.dev-session-acquire.stale-${generation.dev}-${generation.ino}-${token}`)
  const owner = acquireDevSession({ workspaceRoot })
  try {
    assert.equal(fs.existsSync(gateDirectory), false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(tombstone, 'owner.json'), 'utf8')).token, token)
    assert.equal(fs.readdirSync(stateDirectory).filter((name) => name.startsWith('.dev-session-acquire-')).length, 0)
  } finally {
    owner.release()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('a live acquisition gate times out without losing its owner or leaving a candidate', () => {
  const workspaceRoot = createWorkspace()
  const stateDirectory = path.join(workspaceRoot, '.mercato')
  const gateDirectory = path.join(stateDirectory, 'dev-session-acquire.lock')
  const gateOwner = { pid: process.pid, token: '11111111-1111-4111-8111-111111111111' }
  fs.mkdirSync(gateDirectory, { recursive: true })
  fs.writeFileSync(path.join(gateDirectory, 'owner.json'), JSON.stringify(gateOwner))
  const originalNow = Date.now
  let elapsed = 0
  Date.now = () => originalNow() + (elapsed += 1_000)
  try {
    assert.throws(() => acquireDevSession({ workspaceRoot }), DevSessionConflictError)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(gateDirectory, 'owner.json'), 'utf8')), gateOwner)
    assert.deepEqual(fs.readdirSync(stateDirectory), ['dev-session-acquire.lock'])
  } finally {
    Date.now = originalNow
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('a delayed stale recoverer cannot remove a competing live session', async () => {
  const workspaceRoot = fs.realpathSync(createWorkspace())
  const lockDirectory = path.join(workspaceRoot, '.mercato', 'dev-session.lock')
  const gateDirectory = path.join(workspaceRoot, '.mercato', 'dev-session-acquire.lock')
  const signalPath = path.join(workspaceRoot, 'contender-waiting')
  const resultPath = path.join(workspaceRoot, 'contender-result.json')
  const releasePath = path.join(workspaceRoot, 'contender-release')
  fs.mkdirSync(path.join(lockDirectory, 'members'), { recursive: true })
  fs.writeFileSync(path.join(lockDirectory, 'owner.json'), JSON.stringify({
    version: 1, token: 'stale-session', pid: 2_147_483_647, mode: 'dev', workspaceRoot,
  }))
  const guardUrl = new URL('../dev-session-guard.mjs', import.meta.url).href
  const program = `
    import fs from 'node:fs'
    import { acquireDevSession } from ${JSON.stringify(guardUrl)}
    const originalRename = fs.renameSync
    fs.renameSync = (source, destination, ...options) => {
      try { return originalRename(source, destination, ...options) }
      catch (error) {
        if (destination === ${JSON.stringify(gateDirectory)}) fs.writeFileSync(${JSON.stringify(signalPath)}, 'waiting')
        throw error
      }
    }
    try {
      const session = acquireDevSession({ workspaceRoot: ${JSON.stringify(workspaceRoot)}, token: null })
      fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ result: 'acquired' }))
      const poll = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(releasePath)})) return
        clearInterval(poll)
        session.release()
      }, 10)
    } catch (error) {
      fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ result: error.name === 'DevSessionConflictError' ? 'conflict' : error.message }))
    }
  `
  const originalRename = fs.renameSync
  let contender
  let contenderClosed
  let owner
  let paused = false
  let contenderErrors = ''
  fs.renameSync = (source, destination, ...options) => {
    if (source === lockDirectory && !paused) {
      paused = true
      contender = spawn(process.execPath, ['--input-type=module', '--eval', program], { stdio: ['ignore', 'ignore', 'pipe'] })
      contender.stderr.on('data', (chunk) => { contenderErrors += chunk })
      contenderClosed = new Promise((resolve) => contender.once('close', resolve))
      const deadline = Date.now() + 10_000
      const waitState = new Int32Array(new SharedArrayBuffer(4))
      while (!fs.existsSync(signalPath) && !fs.existsSync(resultPath)) {
        assert.ok(Date.now() < deadline, 'Contender did not reach acquisition')
        Atomics.wait(waitState, 0, 0, 10)
      }
    }
    return originalRename(source, destination, ...options)
  }

  try {
    owner = acquireDevSession({ workspaceRoot, token: null })
    fs.renameSync = originalRename
    const deadline = Date.now() + 10_000
    while (!fs.existsSync(resultPath)) {
      assert.ok(Date.now() < deadline, `Contender did not finish acquisition: ${contenderErrors}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(JSON.parse(fs.readFileSync(resultPath, 'utf8')).result, 'conflict')
    assert.equal(JSON.parse(fs.readFileSync(path.join(lockDirectory, 'owner.json'), 'utf8')).token, owner.token)
  } finally {
    fs.renameSync = originalRename
    if (contender) {
      fs.writeFileSync(releasePath, 'release')
      if (contender.exitCode === null && contender.signalCode === null) contender.kill('SIGTERM')
      await contenderClosed
    }
    owner?.release()
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})
