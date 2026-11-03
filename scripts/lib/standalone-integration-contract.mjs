import path from 'node:path'

const APP_ONLY_KEYS = new Set(['OM_DOCUMENTS_COLLAB_INTEGRATION'])
const TEST_ONLY_KEYS = new Set(['BASE_URL', 'OM_TEST_APP_ROOT', 'OM_DRAIN_DEBUG'])

export function assertStandaloneIntegrationEnvironment({ appEnv, testEnv }) {
  for (const [key, value] of Object.entries(appEnv)) {
    if (!APP_ONLY_KEYS.has(key) && testEnv[key] !== value) {
      throw new Error(`Standalone app/test environment mismatch: ${key}`)
    }
  }
  for (const key of Object.keys(testEnv)) {
    if (!TEST_ONLY_KEYS.has(key) && !(key in appEnv)) {
      throw new Error(`Standalone test setting missing from app environment: ${key}`)
    }
  }
  for (const key of APP_ONLY_KEYS) {
    if (testEnv[key]?.trim()) throw new Error(`Standalone server-only setting leaked into tests: ${key}`)
  }
  for (const key of ['CACHE_SQLITE_PATH', 'OM_TEST_EMAIL_CAPTURE_PATH', 'QUEUE_BASE_DIR']) {
    if (!appEnv[key] || !path.isAbsolute(appEnv[key])) {
      throw new Error(`Standalone cross-process path must be absolute: ${key}`)
    }
  }
  if (!testEnv.OM_TEST_APP_ROOT || !path.isAbsolute(testEnv.OM_TEST_APP_ROOT)) {
    throw new Error('Standalone tests require an absolute OM_TEST_APP_ROOT')
  }
  if (testEnv.BASE_URL !== appEnv.APP_URL) {
    throw new Error('Standalone BASE_URL must match APP_URL')
  }
  if (appEnv.AUTO_SPAWN_WORKERS !== 'false' || appEnv.AUTO_SPAWN_SCHEDULER !== 'false') {
    throw new Error('Standalone integration requires explicit queue draining without managed workers or scheduler')
  }
  if (appEnv.CACHE_STRATEGY !== 'sqlite') {
    throw new Error('Standalone integration requires the shared sqlite cache')
  }
  for (const key of ['SELF_SERVICE_ONBOARDING_ENABLED', 'SYSTEM_EMAIL_PROVIDER', 'OM_TEST_BROWSER_TELEMETRY_MODE']) {
    if (appEnv[key] !== '') {
      throw new Error(`Standalone baseline must explicitly clear unsupported prerequisite: ${key}`)
    }
  }
}
