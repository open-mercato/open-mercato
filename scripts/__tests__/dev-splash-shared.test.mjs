import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertLocalSplashRequest,
  isAcceptableSplashOrigin,
  isLocalSplashHost,
  resolveSplashBindHost,
} from '../dev-splash-shared.mjs'

test('isLocalSplashHost accepts loopback hostnames with and without ports', () => {
  assert.equal(isLocalSplashHost('localhost'), true)
  assert.equal(isLocalSplashHost('localhost:4000'), true)
  assert.equal(isLocalSplashHost('127.0.0.1'), true)
  assert.equal(isLocalSplashHost('127.0.0.1:4000'), true)
  assert.equal(isLocalSplashHost('[::1]:4000'), true)
  assert.equal(isLocalSplashHost('[::1]'), true)
  assert.equal(isLocalSplashHost('LOCALHOST:4000'), true)
})

test('isLocalSplashHost rejects non-loopback hosts', () => {
  assert.equal(isLocalSplashHost('evil.example'), false)
  assert.equal(isLocalSplashHost('evil.example:80'), false)
  assert.equal(isLocalSplashHost('169.254.169.254'), false)
  assert.equal(isLocalSplashHost('192.168.1.100:4000'), false)
  assert.equal(isLocalSplashHost('0.0.0.0:4000'), false)
  assert.equal(isLocalSplashHost('localhost.example.com'), false)
})

test('isLocalSplashHost rejects empty / missing / malformed values', () => {
  assert.equal(isLocalSplashHost(undefined), false)
  assert.equal(isLocalSplashHost(null), false)
  assert.equal(isLocalSplashHost(''), false)
  assert.equal(isLocalSplashHost('   '), false)
  assert.equal(isLocalSplashHost('[::1'), false)
  assert.equal(isLocalSplashHost(42), false)
})

test('isAcceptableSplashOrigin allows missing and empty Origin headers', () => {
  assert.equal(isAcceptableSplashOrigin(undefined), true)
  assert.equal(isAcceptableSplashOrigin(null), true)
  assert.equal(isAcceptableSplashOrigin(''), true)
  assert.equal(isAcceptableSplashOrigin('  '), true)
})

test('isAcceptableSplashOrigin rejects the opaque-origin sentinel', () => {
  assert.equal(isAcceptableSplashOrigin('null'), false)
})

test('isAcceptableSplashOrigin accepts loopback origins', () => {
  assert.equal(isAcceptableSplashOrigin('http://localhost:4000'), true)
  assert.equal(isAcceptableSplashOrigin('http://127.0.0.1:4000'), true)
  assert.equal(isAcceptableSplashOrigin('http://[::1]:4000'), true)
})

test('isAcceptableSplashOrigin rejects foreign and malformed origins', () => {
  assert.equal(isAcceptableSplashOrigin('http://evil.example'), false)
  assert.equal(isAcceptableSplashOrigin('http://169.254.169.254'), false)
  assert.equal(isAcceptableSplashOrigin('not-a-url'), false)
})

test('assertLocalSplashRequest returns 403 for foreign Host', () => {
  const result = assertLocalSplashRequest({
    headers: { host: 'evil.example', origin: 'http://localhost:4000' },
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.match(result.error, /local development host/)
})

test('assertLocalSplashRequest returns 403 for foreign Origin even with local Host', () => {
  const result = assertLocalSplashRequest({
    headers: { host: 'localhost:4000', origin: 'http://evil.example' },
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.match(result.error, /splash origin/)
})

test('assertLocalSplashRequest returns ok for local Host + missing Origin', () => {
  const result = assertLocalSplashRequest({ headers: { host: '127.0.0.1:4000' } })
  assert.equal(result.ok, true)
})

test('assertLocalSplashRequest returns ok for local Host + matching Origin', () => {
  const result = assertLocalSplashRequest({
    headers: { host: '127.0.0.1:4000', origin: 'http://127.0.0.1:4000' },
  })
  assert.equal(result.ok, true)
})

test('assertLocalSplashRequest tolerates a missing headers object', () => {
  const result = assertLocalSplashRequest({})
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
})

function makeLogger() {
  const warnings = []
  return {
    warnings,
    warn(message) { warnings.push(message) },
  }
}

test('resolveSplashBindHost defaults to loopback when env is empty', () => {
  const logger = makeLogger()
  assert.equal(resolveSplashBindHost({}, logger), '127.0.0.1')
  assert.deepEqual(logger.warnings, [])
})

test('resolveSplashBindHost defaults to loopback even when /.dockerenv would have triggered legacy 0.0.0.0', () => {
  // The previous behaviour bound to 0.0.0.0 inside containers. We now require
  // an explicit opt-in regardless of container detection, so no env still means
  // loopback.
  const logger = makeLogger()
  assert.equal(resolveSplashBindHost({ HOME: '/root' }, logger), '127.0.0.1')
  assert.deepEqual(logger.warnings, [])
})

test('resolveSplashBindHost honours explicit OM_DEV_SPLASH_BIND=0.0.0.0 with a loud warning', () => {
  const logger = makeLogger()
  assert.equal(resolveSplashBindHost({ OM_DEV_SPLASH_BIND: '0.0.0.0' }, logger), '0.0.0.0')
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /OM_DEV_SPLASH_BIND=0\.0\.0\.0/)
})

test('resolveSplashBindHost normalises whitespace and case', () => {
  const logger = makeLogger()
  assert.equal(resolveSplashBindHost({ OM_DEV_SPLASH_BIND: '  LOCALHOST  ' }, logger), '127.0.0.1')
  assert.equal(resolveSplashBindHost({ OM_DEV_SPLASH_BIND: '127.0.0.1' }, logger), '127.0.0.1')
})

test('resolveSplashBindHost supports IPv6 binds', () => {
  const logger = makeLogger()
  assert.equal(resolveSplashBindHost({ OM_DEV_SPLASH_BIND: '::1' }, logger), '::1')
  assert.deepEqual(logger.warnings, [])

  const allLogger = makeLogger()
  assert.equal(resolveSplashBindHost({ OM_DEV_SPLASH_BIND: '::' }, allLogger), '::')
  assert.equal(allLogger.warnings.length, 1)
})

test('resolveSplashBindHost falls back to loopback with a warning when the override is unrecognised', () => {
  const logger = makeLogger()
  assert.equal(resolveSplashBindHost({ OM_DEV_SPLASH_BIND: 'garbage' }, logger), '127.0.0.1')
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /Unrecognized OM_DEV_SPLASH_BIND/)
})
