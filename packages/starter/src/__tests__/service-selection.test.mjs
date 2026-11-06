import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { selectDefaultServiceMode } from '../infra-preflight.mjs'
import { ServiceSelectionError, chooseServiceMode } from '../service-modes.mjs'
import { readServiceSettings, selectStarterServiceMode } from '../setup-session.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..', '..')
const SERVICES = [
  { service: 'postgres', port: 5432 },
  { service: 'redis', port: 6379 },
  { service: 'meilisearch', port: 7700 },
]
const LOCAL_URL = 'postgres://postgres:postgres@localhost:5432/open-mercato'
const dockerOk = () => ({ ok: true, code: 'ok' })
const dockerMissing = () => ({ ok: false, code: 'cli-missing', detail: 'docker CLI not found' })

function scenario({ answering = [], detect = dockerOk, owners = [], own = new Set(), verify = async () => {}, databaseUrl = LOCAL_URL } = {}) {
  const calls = { verify: 0, containers: 0 }
  return {
    calls,
    run: () => selectDefaultServiceMode({
      databaseUrl,
      services: SERVICES,
      detect,
      portProbe: async (port) => answering.includes(port),
      containerProbe: () => { calls.containers += 1; return owners },
      listOwnContainers: () => own,
      verifyConnections: async () => { calls.verify += 1; return verify() },
    }),
  }
}

test('(a) answering services that verify are reused', async () => {
  const { run, calls } = scenario({ answering: [5432] })
  const selection = await run()
  assert.equal(selection.mode, 'reuse')
  assert.match(selection.reason, /credentials verified; reusing them/)
  assert.equal(calls.verify, 1)
})

test('(a) this project\'s own running containers are reused when they verify', async () => {
  const { run } = scenario({ answering: [5432], owners: [{ service: 'postgres', port: 5432, containerName: 'mercato-postgres' }], own: new Set(['mercato-postgres']) })
  assert.equal((await run()).mode, 'reuse')
})

test('(b) nothing answering with a usable Docker starts Compose on the configured ports', async () => {
  const { run, calls } = scenario()
  const selection = await run()
  assert.equal(selection.mode, 'compose')
  assert.match(selection.reason, /Nothing answers on the configured ports \(postgres :5432, redis :6379, meilisearch :7700\)/)
  assert.equal(calls.verify, 0)
})

test('(c) rejected credentials on the configured port select an isolated stack', async () => {
  const { run } = scenario({ answering: [5432], verify: async () => { throw Object.assign(new Error('[setup] PostgreSQL connection failed (DATABASE_URL). The service rejected the configured credentials.'), { kind: 'authentication' }) } })
  const selection = await run()
  assert.equal(selection.mode, 'random')
  assert.match(selection.reason, /did not accept the configured settings \(PostgreSQL connection failed/)
  assert.match(selection.reason, /isolated stack on free ports/)
})

test('(c) another project\'s container is never verified and selects an isolated stack', async () => {
  const { run, calls } = scenario({ answering: [5432], owners: [{ service: 'postgres', port: 5432, containerName: 'other-checkout-postgres' }], own: new Set(['mercato-postgres']) })
  const selection = await run()
  assert.equal(selection.mode, 'random')
  assert.match(selection.reason, /container other-checkout-postgres of another project/)
  assert.equal(calls.verify, 0, 'never connect to another project\'s database')
})

test('(c) a container owner is treated as foreign when this project\'s containers cannot be listed', async () => {
  const { run } = scenario({ answering: [5432], owners: [{ service: 'postgres', port: 5432, containerName: 'mercato-postgres' }], own: null })
  assert.equal((await run()).mode, 'random')
})

test('(c) a non-PostgreSQL listener on a configured port selects an isolated stack', async () => {
  const { run } = scenario({ answering: [6379] })
  const selection = await run()
  assert.equal(selection.mode, 'random')
  assert.match(selection.reason, /port 6379 \(redis\) is in use while PostgreSQL does not answer at :5432/)
})

test('own Compose containers that do not verify yet are re-run on the configured ports', async () => {
  const { run } = scenario({ answering: [5432], owners: [{ service: 'postgres', port: 5432, containerName: 'mercato-postgres' }], own: new Set(['mercato-postgres']), verify: async () => { throw new Error('Redis connection failed') } })
  assert.equal((await run()).mode, 'compose')
})

test('(d) Docker unusable and nothing answering stops with the Docker problem', async () => {
  const { run } = scenario({ detect: dockerMissing })
  const selection = await run()
  assert.equal(selection.mode, null)
  assert.deepEqual(selection.problem, { code: 'cli-missing', detail: 'docker CLI not found' })
})

test('(d) Docker unusable and configured services rejecting credentials stops', async () => {
  const { run } = scenario({ answering: [5432], detect: dockerMissing, verify: async () => { throw new Error('rejected') } })
  const selection = await run()
  assert.equal(selection.mode, null)
  assert.match(selection.reason, /Configured services are not usable/)
})

test('(e) Docker unusable but configured services verify: reuse', async () => {
  const { run, calls } = scenario({ answering: [5432], detect: dockerMissing })
  const selection = await run()
  assert.equal(selection.mode, 'reuse')
  assert.match(selection.reason, /Docker is not available \(docker CLI not found\), but the services configured in \.env answer/)
  assert.equal(calls.containers, 0)
})

test('a remote DATABASE_URL is the user\'s explicit choice and is reused without probes', async () => {
  let probed = false
  const selection = await selectDefaultServiceMode({ databaseUrl: 'postgres://me:pw@db.example.com:5432/app', services: SERVICES, detect: () => { probed = true; return dockerOk() }, portProbe: async () => { probed = true; return false }, verifyConnections: async () => {} })
  assert.equal(selection.mode, 'reuse')
  assert.equal(probed, false)
})

test('missing database drivers defer verification instead of replacing configured services', async () => {
  const { run } = scenario({ answering: [5432], verify: async () => { throw Object.assign(new Error('missing'), { kind: 'dependency' }) } })
  assert.equal((await run()).mode, 'reuse')
})

test('explicit service flags bypass the default selection', async () => {
  let selected = false
  const selectDefault = async () => { selected = true; return { mode: 'compose' } }
  for (const [flag, mode] of [['--infra', 'compose'], ['--random-ports', 'random'], ['--ephemeral', 'ephemeral'], ['--no-infra', 'reuse'], ['--reuse-services', 'reuse']]) {
    assert.equal(await chooseServiceMode({ argv: [flag], selectDefault, log: () => {} }), mode)
  }
  assert.equal(selected, false)
})

test('non-interactive runs use the selected default without prompting, even on a TTY', async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true })
  const output = Object.assign(new PassThrough(), { isTTY: true })
  const lines = []
  const mode = await chooseServiceMode({ argv: ['--non-interactive'], input, output, log: (line) => lines.push(line), selectDefault: async () => ({ mode: 'random', reason: 'Configured ports are occupied.' }) })
  assert.equal(mode, 'random')
  assert.deepEqual(lines, ['\n🔎 Configured ports are occupied.\n'])
  assert.equal(output.read(), null, 'no prompt is written')
})

test('a failed default selection throws the Docker problem instead of prompting', async () => {
  await assert.rejects(
    chooseServiceMode({ argv: [], input: {}, output: {}, log: () => {}, selectDefault: async () => ({ mode: null, problem: { code: 'daemon-stopped' }, reason: 'Nothing answers.' }) }),
    (error) => error instanceof ServiceSelectionError && error.problem.code === 'daemon-stopped' && /Nothing answers/.test(error.message),
  )
})

test('the TTY menu marks the selected mode as default and Enter accepts it', async () => {
  const previousCi = process.env.CI
  delete process.env.CI
  try {
    const input = Object.assign(new PassThrough(), { isTTY: true })
    const output = Object.assign(new PassThrough(), { isTTY: true })
    let prompt = ''
    output.on('data', (chunk) => { prompt += chunk })
    const pending = chooseServiceMode({ argv: [], input, output, log: () => {}, selectDefault: async () => ({ mode: 'compose', reason: 'Nothing answers.' }) })
    setTimeout(() => input.write('\n'), 20)
    assert.equal(await pending, 'compose')
    assert.match(prompt, /\[4\] Docker Compose on configured ports \(default\)/)
    assert.doesNotMatch(prompt, /\[1\] reuse configured services \(default\)/)

    const second = chooseServiceMode({ argv: [], input, output, log: () => {}, selectDefault: async () => ({ mode: 'compose' }) })
    setTimeout(() => input.write('3\n'), 20)
    assert.equal(await second, 'random')
  } finally {
    if (previousCi !== undefined) process.env.CI = previousCi
  }
})

test('starter selection reads the app env over root env and examples, with stack ports', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-select-'))
  try {
    fs.mkdirSync(path.join(dir, 'apps', 'mercato'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'apps', 'mercato', '.env.example'), 'DATABASE_URL=postgres://example@localhost:5432/example\n')
    fs.writeFileSync(path.join(dir, '.env'), 'POSTGRES_PORT=15432\nREDIS_PORT=16379\n')
    assert.equal(readServiceSettings(dir, {}).DATABASE_URL, 'postgres://example@localhost:5432/example')
    fs.writeFileSync(path.join(dir, 'apps', 'mercato', '.env'), 'DATABASE_URL=postgres://app@localhost:15432/app\n')
    let received
    await selectStarterServiceMode(dir, { env: {}, select: async (options) => { received = options; return { mode: 'reuse' } } })
    assert.equal(received.databaseUrl, 'postgres://app@localhost:15432/app')
    assert.deepEqual(received.services.map((entry) => entry.port), [15432, 16379, 7700])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a second starter setup in a checkout with a live dev session stops before any .env write or Compose call', { skip: process.platform === 'win32' ? 'fake docker shim is a POSIX shell script' : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-session-'))
  const { acquireDevSession } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'dev-session-guard.mjs')).href)
  let first
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'open-mercato', private: true }))
    fs.mkdirSync(path.join(dir, 'scripts'))
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'dev-session-guard.mjs'), path.join(dir, 'scripts', 'dev-session-guard.mjs'))
    fs.mkdirSync(path.join(dir, 'apps', 'mercato'), { recursive: true })
    const rootEnv = 'POSTGRES_PORT=15432\nREDIS_PORT=16379\nMEILISEARCH_PORT=17700\n'
    const appEnv = 'DATABASE_URL=postgres://mercato:secret@127.0.0.1:15432/app\n'
    fs.writeFileSync(path.join(dir, '.env'), rootEnv)
    fs.writeFileSync(path.join(dir, 'apps', 'mercato', '.env'), appEnv)
    const bin = path.join(dir, 'fake-bin')
    fs.mkdirSync(bin)
    const dockerLog = path.join(dir, 'docker.log')
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dockerLog}"\nexit 0\n`, { mode: 0o755 })
    first = acquireDevSession({ workspaceRoot: dir, mode: 'setup:hybrid', role: 'starter' })

    const child = spawn(process.execPath, [path.join(repoRoot, 'packages', 'starter', 'src', 'cli.mjs'), 'up', '--random-ports', '--non-interactive'], {
      cwd: dir,
      env: { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`, HOME: dir, CI: 'true' },
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const code = await new Promise((resolve) => child.on('close', (exitCode) => resolve(exitCode)))

    assert.equal(code, 2, output)
    assert.match(output, /Another Open Mercato dev session already owns this workspace/)
    assert.match(output, /No service configuration, \.env file or container was changed/)
    assert.equal(fs.existsSync(dockerLog), false, 'no docker command may run')
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), rootEnv)
    assert.equal(fs.readFileSync(path.join(dir, 'apps', 'mercato', '.env'), 'utf8'), appEnv)
    const owner = JSON.parse(fs.readFileSync(path.join(dir, '.mercato', 'dev-session.lock', 'owner.json'), 'utf8'))
    assert.equal(owner.token, first.token)
  } finally {
    first?.release()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the starter session hands its token to the dev runner and releases on failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-own-'))
  try {
    fs.mkdirSync(path.join(dir, 'scripts'))
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'dev-session-guard.mjs'), path.join(dir, 'scripts', 'dev-session-guard.mjs'))
    const { acquireSetupSession } = await import('../setup-session.mjs')
    const session = await acquireSetupSession(dir)
    assert.match(session.childEnv.OM_DEV_SESSION_TOKEN, /^[0-9a-f-]{36}$/i)
    assert.equal(session.childEnv.OM_DEV_SESSION_WORKSPACE_ROOT, fs.realpathSync(dir))
    const { acquireDevSession } = await import(pathToFileURL(path.join(dir, 'scripts', 'dev-session-guard.mjs')).href)
    const devRunner = acquireDevSession({ workspaceRoot: dir, token: session.token, role: 'dev-runner' })
    assert.equal(devRunner.token, session.token, 'the dev runner joins the setup session')
    devRunner.release()
    session.release()
    assert.equal(fs.existsSync(path.join(dir, '.mercato', 'dev-session.lock')), false)
    assert.equal(await acquireSetupSession(path.join(dir, 'missing')), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a fresh clone without Docker or services fails within seconds, before yarn install or builds', { skip: process.platform === 'win32' ? 'fake shims are POSIX shell scripts' : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-fresh-'))
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'open-mercato', private: true }))
    fs.mkdirSync(path.join(dir, 'scripts'))
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'dev-session-guard.mjs'), path.join(dir, 'scripts', 'dev-session-guard.mjs'))
    fs.mkdirSync(path.join(dir, 'apps', 'mercato'), { recursive: true })
    const net = await import('node:net')
    const freePort = () => new Promise((resolve) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) }) })
    const [postgres, redis, meili] = [await freePort(), await freePort(), await freePort()]
    fs.writeFileSync(path.join(dir, '.env'), `POSTGRES_PORT=${postgres}\nREDIS_PORT=${redis}\nMEILISEARCH_PORT=${meili}\n`)
    fs.writeFileSync(path.join(dir, 'apps', 'mercato', '.env.example'), `DATABASE_URL=postgres://postgres:postgres@localhost:${postgres}/open-mercato\n`)
    const bin = path.join(dir, 'fake-bin')
    fs.mkdirSync(bin)
    const yarnLog = path.join(dir, 'yarn.log')
    fs.writeFileSync(path.join(bin, 'yarn'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${yarnLog}"\nexit 0\n`, { mode: 0o755 })
    const started = Date.now()
    const child = spawn(process.execPath, [path.join(repoRoot, 'packages', 'starter', 'src', 'cli.mjs'), 'up', '--non-interactive'], {
      cwd: dir,
      env: { PATH: bin, HOME: dir, CI: 'true' },
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const code = await new Promise((resolve) => child.on('close', (exitCode) => resolve(exitCode)))
    assert.equal(code, 2, output)
    assert.ok(Date.now() - started < 15_000, 'must fail within seconds')
    assert.match(output, /Docker is not installed/)
    assert.match(output, /https:\/\/github\.com\/open-mercato\/open-mercato#without-docker/)
    assert.match(output, /node packages\/starter\/bin\/om-start\.mjs up --no-infra/)
    assert.equal(fs.existsSync(yarnLog), false, 'no yarn install or build may run')
    assert.equal(fs.existsSync(path.join(dir, '.mercato', 'dev-session.lock')), false, 'the session is released')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
