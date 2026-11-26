import { normalizeWorkload } from './pure/workload.js'
import { parseDuration } from './pure/stages.js'

const FIXTURES_DIR = '/perf/k6/fixtures'

function readEnv(name, fallback) {
  const value = __ENV[name]
  return value === undefined || value === '' ? fallback : value
}

function readNumber(name, fallback) {
  const parsed = Number(readEnv(name, ''))
  return Number.isFinite(parsed) && readEnv(name, '') !== '' ? parsed : fallback
}

function readFlag(name, fallback = false) {
  const value = String(readEnv(name, '')).trim().toLowerCase()
  if (value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function openFirst(paths) {
  for (const path of paths) {
    try {
      return { path, text: open(path) }
    } catch (error) {
      continue
    }
  }
  return null
}

export const env = {
  baseUrl: String(readEnv('BASE_URL', 'https://tls:8443')).replace(/\/+$/, ''),
  tier: readEnv('TIER', 'XS'),
  profile: readEnv('PROFILE', 'mini'),
  runId: readEnv('RUN_ID', 'local'),
  phase: readEnv('PHASE', ''),
  catalogPath: readEnv('CATALOG', `${FIXTURES_DIR}/catalog.json`),
  usersPath: readEnv('USERS', `${FIXTURES_DIR}/users.json`),
  workloadPath: readEnv('WORKLOAD', ''),
  summaryOut: readEnv('SUMMARY_OUT', ''),
  insecureTls: readFlag('INSECURE_TLS', false),
  seed: readEnv('SEED', '42'),
  samples: readNumber('SAMPLES', NaN),
  warmupRounds: readNumber('WARMUP_ROUNDS', NaN),
  kneeVus: readNumber('KNEE_VUS', NaN),
  soakVus: readNumber('SOAK_VUS', NaN),
  interferenceVus: readNumber('INTERFERENCE_VUS', NaN),
  withBrowser: readFlag('WITH_BROWSER', false),
  browserVus: readNumber('BROWSER_VUS', NaN),
  browserDuration: readEnv('BROWSER_DURATION', ''),
  smokeDuration: readEnv('SMOKE_DURATION', ''),
  thinkEnabled: readFlag('THINK', true),
  thinkScale: readNumber('THINK_SCALE', 1),
  httpTimeout: readEnv('HTTP_TIMEOUT', '60s'),
  tokenRefreshAfterSec: readNumber('TOKEN_REFRESH_AFTER', 7 * 3600),
  loginWithTenant: readFlag('LOGIN_WITH_TENANT', true),
  excludeJourneys: String(readEnv('EXCLUDE_JOURNEYS', '')).split(',').map((item) => item.trim()).filter(Boolean),
  safetyAbort: readFlag('SAFETY_ABORT', true),
}

function loadWorkload() {
  const candidates = env.workloadPath
    ? [env.workloadPath]
    : ['/perf/config/workload.json', `${FIXTURES_DIR}/workload.json`]
  const loaded = openFirst(candidates)
  if (!loaded) return { path: null, workload: normalizeWorkload(null) }
  return { path: loaded.path, workload: normalizeWorkload(JSON.parse(loaded.text)) }
}

const workloadSource = loadWorkload()

export const workload = workloadSource.workload
export const workloadPath = workloadSource.path

export function baseOptions(scenarioName) {
  return {
    insecureSkipTLSVerify: env.insecureTls,
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
    tags: { phase: env.phase || scenarioName },
    systemTags: ['status', 'method', 'name', 'check', 'error', 'error_code', 'scenario', 'expected_response'],
    setupTimeout: '5m',
    teardownTimeout: '5m',
  }
}

export function safetyErrorWindowMs() {
  return parseDuration(workload.safety.errorWindow) * 1000
}
