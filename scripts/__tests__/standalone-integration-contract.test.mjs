import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createStandaloneIntegrationEnvironment } from '../lib/standalone-integration-env.mjs'
import { assertStandaloneIntegrationEnvironment } from '../lib/standalone-integration-contract.mjs'

function environment() {
  return createStandaloneIntegrationEnvironment({
    appDir: path.resolve('/tmp/standalone-app'),
    repoRoot: path.resolve('/tmp/repository'),
    baseUrl: 'http://localhost:3001',
    databaseUrl: 'postgres://fixture:fixture@localhost:5432/fixture',
  })
}

test('standalone environment keeps server and drain processes on the same stores', () => {
  assert.doesNotThrow(() => assertStandaloneIntegrationEnvironment(environment()))
})

test('a cache path changed on only the app side fails before building', () => {
  const configuration = environment()
  configuration.appEnv.CACHE_SQLITE_PATH = '/tmp/other-cache.db'
  assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), /mismatch: CACHE_SQLITE_PATH/)
})

test('an email prerequisite set only on the test side cannot silently enable discovery', () => {
  const configuration = environment()
  configuration.testEnv.SYSTEM_EMAIL_PROVIDER = '__test_seed__'
  assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), /mismatch: SYSTEM_EMAIL_PROVIDER/)
})

test('a nonempty false prerequisite is rejected rather than selecting unavailable tests', () => {
  for (const key of ['SELF_SERVICE_ONBOARDING_ENABLED', 'SYSTEM_EMAIL_PROVIDER', 'OM_TEST_BROWSER_TELEMETRY_MODE']) {
    const configuration = environment()
    configuration.appEnv[key] = 'false'
    configuration.testEnv[key] = 'false'
    assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), new RegExp(`clear unsupported prerequisite: ${key}`))
  }
})

test('the app-only collaboration flag cannot opt Playwright into a different suite', () => {
  const configuration = environment()
  configuration.testEnv.OM_DOCUMENTS_COLLAB_INTEGRATION = '1'
  assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), /server-only setting leaked/)
})

test('even matching relative queue paths are rejected across different working directories', () => {
  const configuration = environment()
  configuration.appEnv.QUEUE_BASE_DIR = '.mercato/queue'
  configuration.testEnv.QUEUE_BASE_DIR = '.mercato/queue'
  assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), /path must be absolute: QUEUE_BASE_DIR/)
})

test('test-only settings cannot be added without an app-side counterpart', () => {
  const configuration = environment()
  configuration.testEnv.MOCK_NEW_WEBHOOK_SECRET = 'fixture'
  assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), /missing from app environment: MOCK_NEW_WEBHOOK_SECRET/)
})

test('managed workers cannot race the explicit queue drain', () => {
  const configuration = environment()
  configuration.appEnv.AUTO_SPAWN_WORKERS = 'true'
  configuration.testEnv.AUTO_SPAWN_WORKERS = 'true'
  assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), /explicit queue draining/)
})

test('environment errors identify keys without printing secret values', () => {
  const configuration = environment()
  configuration.appEnv.JWT_SECRET = 'private-test-sentinel'
  assert.throws(() => assertStandaloneIntegrationEnvironment(configuration), (error) => {
    assert.match(error.message, /JWT_SECRET/)
    assert.doesNotMatch(error.message, /private-test-sentinel/)
    return true
  })
})
