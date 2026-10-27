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
