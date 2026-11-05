import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createDevSplashCodingFlow } from '../dev-splash-coding-flow.mjs'

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(payload) { this.body = payload ?? ''; this.ended = true },
  }
}

function createMockRequest({ method = 'POST', url = '/actions/start-coding', headers = {}, body = '' } = {}) {
  const handlers = {}
  return {
    method,
    url,
    headers,
    setEncoding() {},
    destroy() {},
    on(event, fn) {
      ;(handlers[event] = handlers[event] || []).push(fn)
      if (event === 'end') {
        queueMicrotask(() => {
          handlers.data?.forEach((cb) => cb(body))
          handlers.end?.forEach((cb) => cb())
        })
      }
      return this
    },
    once(event, fn) { return this.on(event, fn) },
    off() { return this },
  }
}

function createFlow() {
  // PATH='' makes detectSplashCodingTools return no tools, so even if the
  // handler proceeded, startCoding would short-circuit before any spawn.
  return createDevSplashCodingFlow({
    env: { PATH: '', OM_ENABLE_CODING_FLOW_FROM_SPLASH: '1' },
    platform: 'linux',
    launchDir: process.cwd(),
    agenticSetupDir: null,
  })
}

test('coding flow handleRequest rejects POST with foreign Host even with valid token', async () => {
  const flow = createFlow()
  const token = flow.getBootstrapPayload().actionToken

  const req = createMockRequest({
    headers: { host: 'evil.example', 'x-om-dev-splash-token': token },
    body: JSON.stringify({ toolId: 'cursor' }),
  })
  const res = createMockResponse()

  const handled = await flow.handleRequest(req, res, { ready: true })

  assert.equal(handled, true)
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.match(payload.error, /loopback host or an entry in ALLOWED_ORIGINS/)
})

test('coding flow handleRequest rejects POST with foreign Origin even with valid token', async () => {
  const flow = createFlow()
  const token = flow.getBootstrapPayload().actionToken

  const req = createMockRequest({
    headers: {
      host: 'localhost:4000',
      origin: 'http://evil.example',
      'x-om-dev-splash-token': token,
    },
    body: JSON.stringify({ toolId: 'cursor' }),
  })
  const res = createMockResponse()

  const handled = await flow.handleRequest(req, res, { ready: true })

  assert.equal(handled, true)
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.match(payload.error, /splash origin/)
})

test('coding flow handleRequest passes Host/Origin checks before token check', async () => {
  const flow = createFlow()

  // Valid Host/Origin but wrong token still yields the existing token 403,
  // proving the new guard runs first without altering the token contract.
  const req = createMockRequest({
    headers: {
      host: 'localhost:4000',
      origin: 'http://localhost:4000',
      'x-om-dev-splash-token': 'definitely-wrong',
    },
    body: JSON.stringify({ toolId: 'cursor' }),
  })
  const res = createMockResponse()

  const handled = await flow.handleRequest(req, res, { ready: true })

  assert.equal(handled, true)
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.match(payload.error, /splash action token/)
})

const LOCAL_HEADERS = { host: 'localhost:4000', origin: 'http://localhost:4000' }

function createBuildingRequest(flow, overrides = {}) {
  return createMockRequest({
    url: '/actions/start-building',
    headers: { ...LOCAL_HEADERS, 'x-om-dev-splash-token': flow.getBootstrapPayload().actionToken },
    body: '{}',
    ...overrides,
  })
}

function createStubTerminalFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-splash-building-handler-'))
  const binDir = path.join(tempDir, 'bin')
  const projectDir = path.join(tempDir, 'project')
  const outputFile = path.join(tempDir, 'terminal-args.txt')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(path.join(projectDir, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'package.json'), '{}\n')
  fs.writeFileSync(path.join(binDir, 'npx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  fs.writeFileSync(
    path.join(binDir, 'xterm'),
    `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > '${outputFile}'\n`,
    { mode: 0o755 },
  )
  return { tempDir, binDir, projectDir, outputFile }
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').length > 0) {
      return fs.readFileSync(filePath, 'utf8')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

test('start-building is not claimed when the coding flow is disabled', async () => {
  const flow = createDevSplashCodingFlow({
    env: { PATH: '', OM_ENABLE_CODING_FLOW_FROM_SPLASH: 'false' },
    platform: 'linux',
  })
  const res = createMockResponse()
  const handled = await flow.handleRequest(createMockRequest({ url: '/actions/start-building', headers: LOCAL_HEADERS }), res)

  assert.equal(handled, false)
  assert.equal(res.ended, false)
  assert.deepEqual(flow.getSnapshot({ ready: false }), { enabled: false })
})

test('start-building rejects non-POST, foreign hosts, and invalid tokens', async () => {
  const flow = createFlow()

  const getRes = createMockResponse()
  await flow.handleRequest(createBuildingRequest(flow, { method: 'GET' }), getRes)
  assert.equal(getRes.statusCode, 405)

  const foreignRes = createMockResponse()
  await flow.handleRequest(createBuildingRequest(flow, {
    headers: { host: 'evil.example', 'x-om-dev-splash-token': flow.getBootstrapPayload().actionToken },
  }), foreignRes)
  assert.equal(foreignRes.statusCode, 403)

  const tokenRes = createMockResponse()
  await flow.handleRequest(createBuildingRequest(flow, {
    headers: { ...LOCAL_HEADERS, 'x-om-dev-splash-token': 'wrong' },
  }), tokenRes)
  assert.equal(tokenRes.statusCode, 403)
  assert.match(JSON.parse(tokenRes.body).error, /splash action token/)
})

test('start-building refuses any browser-supplied command, path, or URL', async () => {
  const flow = createFlow()
  const payloads = [
    JSON.stringify({ command: 'rm -rf /' }),
    JSON.stringify({ projectDir: '/etc' }),
    JSON.stringify({ previewUrl: 'http://localhost:3000' }),
    JSON.stringify(['cezar-run']),
    'null',
    '{not json',
  ]

  for (const body of payloads) {
    const res = createMockResponse()
    const handled = await flow.handleRequest(createBuildingRequest(flow, { body }), res)
    assert.equal(handled, true)
    assert.equal(res.statusCode, 400, `expected 400 for ${body}`)
  }
})

test('start-building reports npx_missing with the manual command, independent of readiness', async () => {
  const flow = createFlow()
  const res = createMockResponse()

  await flow.handleRequest(createBuildingRequest(flow), res, { ready: false, failed: false })

  assert.equal(res.statusCode, 500)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'npx_missing')
  assert.match(payload.error, /npx cezar-run/)
  assert.equal(payload.codingFlow.building.available, false)
  assert.equal(payload.codingFlow.building.reason, 'npx_missing')
  assert.equal(payload.codingFlow.building.manualCommand, 'npx cezar-run')
  assert.equal(payload.codingFlow.building.lastResult.code, 'npx_missing')
  assert.equal(payload.codingFlow.busy, false)
})

test('start-building launches plain npx cezar-run in the project root and blocks a fast relaunch', { skip: process.platform === 'win32' }, async () => {
  const fixture = createStubTerminalFixture()
  let clock = 1_000
  try {
    const flow = createDevSplashCodingFlow({
      env: { PATH: fixture.binDir, OM_ENABLE_CODING_FLOW_FROM_SPLASH: '1' },
      platform: 'linux',
      launchDir: path.join(fixture.projectDir, 'scripts'),
      projectDir: fixture.projectDir,
      now: () => clock,
    })

    const snapshot = flow.getSnapshot({ ready: false })
    assert.equal(snapshot.building.available, true)
    assert.equal(snapshot.building.reason, null)

    const res = createMockResponse()
    await flow.handleRequest(createBuildingRequest(flow), res, { ready: false })
    assert.equal(res.statusCode, 200)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.codingFlow.building.lastResult.code, 'started')

    const terminalArgs = (await waitForFile(fixture.outputFile)).trim().split('\n')
    assert.deepEqual(terminalArgs.slice(1, 4), ['-e', 'bash', '-lc'])
    const shellCommand = terminalArgs.slice(4).join('\n')
    assert.equal(
      shellCommand,
      `cd '${path.resolve(fixture.projectDir)}' && '${path.join(fixture.binDir, 'npx')}' 'cezar-run'; exec "\${SHELL:-bash}"`,
    )
    assert.doesNotMatch(shellCommand, /--preview|--url|http:/)

    clock += 1_000
    const repeatRes = createMockResponse()
    await flow.handleRequest(createBuildingRequest(flow), repeatRes, { ready: false })
    assert.equal(repeatRes.statusCode, 409)
    assert.equal(JSON.parse(repeatRes.body).code, 'already_started')
    assert.equal(flow.getSnapshot().building.lastResult.code, 'already_started')

    clock += 10_000
    fs.rmSync(fixture.outputFile, { force: true })
    const laterRes = createMockResponse()
    await flow.handleRequest(createBuildingRequest(flow), laterRes, { ready: true })
    assert.equal(laterRes.statusCode, 200)
    await waitForFile(fixture.outputFile)
  } finally {
    fs.rmSync(fixture.tempDir, { recursive: true, force: true })
  }
})

test('start-coding contract is unchanged by the building route', async () => {
  const flow = createFlow()
  const res = createMockResponse()
  await flow.handleRequest(createMockRequest({
    headers: { ...LOCAL_HEADERS, 'x-om-dev-splash-token': flow.getBootstrapPayload().actionToken },
    body: JSON.stringify({ toolId: 'cezar' }),
  }), res, { ready: true })

  assert.equal(res.statusCode, 400)
  assert.match(JSON.parse(res.body).error, /Unknown coding tool selection/)
})
