import test from 'node:test'
import assert from 'node:assert/strict'

import { createDevSplashGitRepoFlow } from '../dev-splash-git-repo-flow.mjs'

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(payload) { this.body = payload ?? ''; this.ended = true },
  }
  return res
}

function createMockRequest({ method = 'POST', url = '/actions/git-repo-flow/start', headers = {}, body = '' } = {}) {
  const handlers = {}
  const req = {
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
    once(event, fn) {
      const wrapped = (...args) => { fn(...args) }
      return this.on(event, wrapped)
    },
    off() { return this },
  }
  return req
}

function createFlow({ runCommand } = {}) {
  return createDevSplashGitRepoFlow({
    env: { PATH: '' },
    platform: 'linux',
    launchDir: '/tmp/nonexistent-splash-test',
    enabled: true,
    runCommand: runCommand ?? (async () => ({ code: 1, signal: null, stdout: '', stderr: '' })),
    readTextFile: () => '{}',
  })
}

test('handleRequest rejects POST when Host header is foreign even with valid action token', async () => {
  const flow = createFlow()
  const validToken = flow.getBootstrapPayload().actionToken
  let runCommandCalled = false
  const flowWithSpy = createDevSplashGitRepoFlow({
    env: { PATH: '' },
    platform: 'linux',
    launchDir: '/tmp/nonexistent-splash-test',
    enabled: true,
    runCommand: async () => { runCommandCalled = true; return { code: 0, signal: null, stdout: '', stderr: '' } },
    readTextFile: () => '{}',
  })
  const spyToken = flowWithSpy.getBootstrapPayload().actionToken

  const req = createMockRequest({
    headers: { host: 'evil.example', 'x-om-dev-splash-token': spyToken },
    body: '{}',
  })
  const res = createMockResponse()

  const handled = await flowWithSpy.handleRequest(req, res, { ready: true })

  assert.equal(handled, true)
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, false)
  assert.match(payload.error, /loopback host or an entry in ALLOWED_ORIGINS/)
  assert.equal(runCommandCalled, false, 'mutating commands must not run when Host is foreign')
  assert.ok(typeof validToken === 'string' && validToken.length > 0)
})

test('handleRequest rejects POST when Origin header is foreign', async () => {
  let runCommandCalled = false
  const flow = createDevSplashGitRepoFlow({
    env: { PATH: '' },
    platform: 'linux',
    launchDir: '/tmp/nonexistent-splash-test',
    enabled: true,
    runCommand: async () => { runCommandCalled = true; return { code: 0, signal: null, stdout: '', stderr: '' } },
    readTextFile: () => '{}',
  })
  const token = flow.getBootstrapPayload().actionToken

  const req = createMockRequest({
    headers: {
      host: 'localhost:4000',
      origin: 'http://evil.example',
      'x-om-dev-splash-token': token,
    },
    body: '{}',
  })
  const res = createMockResponse()

  const handled = await flow.handleRequest(req, res, { ready: true })

  assert.equal(handled, true)
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, false)
  assert.match(payload.error, /splash origin/)
  assert.equal(runCommandCalled, false)
})

test('handleRequest still rejects with 403 when token is wrong but Host is local', async () => {
  const flow = createFlow()

  const req = createMockRequest({
    headers: { host: 'localhost:4000', origin: 'http://localhost:4000', 'x-om-dev-splash-token': 'wrong' },
    body: '{}',
  })
  const res = createMockResponse()

  const handled = await flow.handleRequest(req, res, { ready: true })

  assert.equal(handled, true)
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.match(payload.error, /splash action token/)
})

test('handleRequest passes Host+Origin+token checks and reaches busy/ready gates', async () => {
  // With a valid Host, Origin and token, the handler should advance past auth.
  // We assert the `ready: false` gate fires next, proving the request passed
  // the new local-origin guard.
  const flow = createFlow()
  const token = flow.getBootstrapPayload().actionToken

  const req = createMockRequest({
    headers: {
      host: '127.0.0.1:4000',
      origin: 'http://127.0.0.1:4000',
      'x-om-dev-splash-token': token,
    },
    body: '{}',
  })
  const res = createMockResponse()

  const handled = await flow.handleRequest(req, res, { ready: false })

  assert.equal(handled, true)
  assert.equal(res.statusCode, 409)
  const payload = JSON.parse(res.body)
  assert.match(payload.error, /only available after the app is ready/)
})
