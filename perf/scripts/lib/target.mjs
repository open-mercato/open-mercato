import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseEnvText } from './env.mjs'
import { SUT_ENV_PATH, TARGET_ENV_PATH, statePath } from './paths.mjs'
import { readJsonFile, writeJsonFile, ensureStateDir } from './state.mjs'

const REQUIRED_TARGET_KEYS = ['PERF_TARGET_NAME', 'PERF_TARGET_KIND', 'BASE_URL', 'GENERATOR_LOCATION', 'HARDWARE_PROFILE']

export function loadTarget() {
  if (!existsSync(TARGET_ENV_PATH)) {
    throw new Error('[perf] perf/config/target.local.env is missing; copy perf/config/target.example.env and edit it')
  }
  const entries = parseEnvText(readFileSync(TARGET_ENV_PATH, 'utf8'))
  const target = Object.fromEntries(entries)
  const missing = REQUIRED_TARGET_KEYS.filter((key) => !target[key])
  if (missing.length) throw new Error(`[perf] target.local.env lacks ${missing.join(', ')}`)
  if (!['local', 'vps'].includes(target.PERF_TARGET_KIND)) throw new Error('[perf] PERF_TARGET_KIND must be local or vps')
  if (target.PERF_TARGET_KIND === 'vps' && !target.SUT_SSH) throw new Error('[perf] a vps target needs SUT_SSH')
  target.CONTROL_BASE_URL = stripSlash(target.CONTROL_BASE_URL || deriveControlUrl(target.BASE_URL))
  target.CALIBRATE_URL = stripSlash(target.CALIBRATE_URL || target.CONTROL_BASE_URL)
  target.PROM_QUERY_URL = stripSlash(target.PROM_QUERY_URL || 'http://127.0.0.1:9090')
  target.BASE_URL = stripSlash(target.BASE_URL)
  return target
}

export function loadSutEnv() {
  if (!existsSync(SUT_ENV_PATH)) throw new Error('[perf] perf/config/sut.local.env is missing; run perf/bin/perf init-secrets')
  return parseEnvText(readFileSync(SUT_ENV_PATH, 'utf8'))
}

export function deriveControlUrl(baseUrl) {
  const url = new URL(baseUrl)
  if (url.hostname === 'tls') url.hostname = 'localhost'
  return url.toString()
}

function stripSlash(value) {
  return String(value).replace(/\/+$/, '')
}

export function targetIdentity(target) {
  const material = [target.PERF_TARGET_NAME, target.PERF_TARGET_KIND, target.BASE_URL, target.SUT_SSH ?? ''].join('|')
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}

const TARGET_BOUND_STATE = ['tenant.json', 'users.json', 'owners.json', 'background-tenants.json', 'last-restore.json', 'snapshots']

export function assertTargetAcknowledged(target, flags) {
  const path = statePath('target-ack.json')
  const identity = targetIdentity(target)
  const ack = readJsonFile(path, null)
  if (ack && ack.identity === identity) return
  const foreignState = ack ? TARGET_BOUND_STATE.filter((file) => existsSync(statePath(file))) : []
  if (foreignState.length) {
    throw new Error(`[perf] perf/.state belongs to target "${ack.name}" (${ack.baseUrl}) and holds ${foreignState.join(', ')}. Using it against "${target.PERF_TARGET_NAME}" (${target.BASE_URL}) would reuse the wrong tenant, users and snapshots. Move it aside first: mv perf/.state perf/.state-${ack.name}`)
  }
  if (!flags['yes-this-is-a-perf-target']) {
    throw new Error(`[perf] target "${target.PERF_TARGET_NAME}" (${target.BASE_URL}) is not confirmed yet. It will be seeded, mutated and load-tested. Re-run with --yes-this-is-a-perf-target once you are sure it is a dedicated perf SUT.`)
  }
  ensureStateDir()
  writeJsonFile(path, { identity, name: target.PERF_TARGET_NAME, baseUrl: target.BASE_URL, confirmedAt: new Date().toISOString() }, 0o600)
}

export function isLocalValidation(target) {
  return target.PERF_TARGET_KIND === 'local'
}
