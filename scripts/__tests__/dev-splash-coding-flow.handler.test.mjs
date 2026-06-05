import test from 'node:test'
import assert from 'node:assert/strict'

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
  assert.match(payload.error, /local development host/)
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
