import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCacheProviderHostContext, isCacheProviderError, resolveCacheProvider } from '@open-mercato/cache/provider'
import type { CacheProviderEnv, CacheProviderLogger, CacheProviderRegistration, ResolvedCacheProvider } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderConformance, randomNamespace } from '@open-mercato/cache/testing/conformance'
import { isManagedCredentialUnavailableError } from '../src/credentials'
import type { EnterpriseCacheProviderRegistrationOptions } from '../src/enterprise'

export const LIVE_PROFILE_ENV = 'OM_CACHE_LIVE_PROFILE'
export const LIVE_NAMESPACE_PREFIX_ENV = 'OM_CACHE_LIVE_NAMESPACE_PREFIX'
export const LIVE_EVIDENCE_DIR_ENV = 'OM_CACHE_LIVE_EVIDENCE_DIR'
export const LIVE_RUNNER_REF_ENV = 'OM_CACHE_LIVE_RUNNER_REF'

export type LiveEnv = Record<string, string | undefined>

export type LiveEndpoint = { host: string; port: number }

export type LiveProfile = {
  /** Generic profile id, e.g. `azure-nonclustered-entra-tls`. */
  id: string
  description: string
  /** Env variable names that must be present (values are never printed). */
  required: string[]
  optional: string[]
  /** Build raw provider settings from the env; reads only the declared names. */
  settings(env: LiveEnv): Record<string, unknown>
  /** First endpoint the client dials, used for the collection-time reachability check. */
  endpoint(env: LiveEnv): LiveEndpoint
}

export type LiveReadiness =
  | { state: 'not-requested' }
  | { state: 'unknown-profile'; message: string }
  | { state: 'blocked'; profile: LiveProfile; message: string; missing: string[]; reason: string }
  | { state: 'ready'; profile: LiveProfile }

/**
 * Decide from the env alone whether a live profile can run. Messages name env
 * variables and profile ids only — never values, endpoints or identities.
 */
export function readLiveReadiness(profiles: LiveProfile[], env: LiveEnv = process.env): LiveReadiness {
  const requested = env[LIVE_PROFILE_ENV]?.trim()
  if (!requested) return { state: 'not-requested' }
  const profile = profiles.find((candidate) => candidate.id === requested)
  if (!profile) {
    return { state: 'unknown-profile', message: `${LIVE_PROFILE_ENV} names an unknown profile; this package defines: ${profiles.map((candidate) => candidate.id).join(', ')}` }
  }
  const missing = [...profile.required, LIVE_NAMESPACE_PREFIX_ENV].filter((name) => !env[name] || env[name]!.trim().length === 0)
  if (missing.length > 0) {
    return {
      state: 'blocked',
      profile,
      missing,
      reason: `missing:${missing.join(',')}`,
      message: `live profile ${profile.id} is blocked: missing ${missing.join(', ')}. Supply them through the approved CI secret store or workload identity (see RUNBOOK.md); never on the command line, in Git or in chat.`,
    }
  }
  if (!/^[a-zA-Z0-9._-]{1,24}$/.test(env[LIVE_NAMESPACE_PREFIX_ENV]!.trim())) {
    return { state: 'blocked', profile, missing: [LIVE_NAMESPACE_PREFIX_ENV], reason: `missing:${LIVE_NAMESPACE_PREFIX_ENV}`, message: `live profile ${profile.id} is blocked: ${LIVE_NAMESPACE_PREFIX_ENV} must be 1-24 letters, digits, ".", "_" or "-" (an owner-approved isolated test namespace prefix)` }
  }
  return { state: 'ready', profile }
}

export type LiveReachability = 'reachable' | 'dns' | 'unreachable' | 'timeout'

export type LiveReachabilityProbe = (endpoint: LiveEndpoint) => LiveReachability

const REACHABILITY_TIMEOUT_MS = 5_000

const REACHABILITY_SCRIPT = `
const net = require('node:net')
const dns = require('node:dns')
const [host, port, timeout] = process.argv.slice(1)
const done = (result) => { process.stdout.write(result); process.exit(0) }
dns.lookup(host, (error) => {
  if (error) return done(error.code === 'ETIMEOUT' ? 'timeout' : 'dns')
  const socket = net.connect({ host, port: Number(port) })
  socket.setTimeout(Number(timeout), () => { socket.destroy(); done('timeout') })
  socket.on('connect', () => { socket.destroy(); done('reachable') })
  socket.on('error', (failure) => done(failure.code === 'ETIMEDOUT' ? 'timeout' : 'unreachable'))
})
`

/**
 * Synchronous DNS + TCP reachability check (in a child process, so it can run
 * while jest collects tests). Only the outcome class is returned or printed.
 */
export function probeEndpointReachabilitySync(endpoint: LiveEndpoint, timeoutMs: number = REACHABILITY_TIMEOUT_MS): LiveReachability {
  const result = spawnSync(process.execPath, ['-e', REACHABILITY_SCRIPT, endpoint.host, String(endpoint.port), String(timeoutMs)], {
    encoding: 'utf8',
    timeout: timeoutMs * 2 + 2_000,
  })
  const outcome = (result.stdout ?? '').trim()
  if (outcome === 'reachable' || outcome === 'dns' || outcome === 'unreachable' || outcome === 'timeout') return outcome
  return 'timeout'
}

/**
 * Collection-time readiness: the env check plus, for a ready profile, a
 * network reachability check of its endpoint. Anything blocked here becomes a
 * real jest skip; only reachable, fully configured profiles run.
 */
export function readLiveCollectionReadiness(
  profiles: LiveProfile[],
  env: LiveEnv = process.env,
  reachability: LiveReachabilityProbe = probeEndpointReachabilitySync,
): LiveReadiness {
  const readiness = readLiveReadiness(profiles, env)
  if (readiness.state !== 'ready') return readiness
  const outcome = reachability(readiness.profile.endpoint(env))
  if (outcome === 'reachable') return readiness
  return {
    state: 'blocked',
    profile: readiness.profile,
    missing: [],
    reason: `network:${outcome}`,
    message: `live profile ${readiness.profile.id} is blocked: the configured endpoint is not reachable from this runner (${outcome}). Run the job on a runner with private network access to the instance (see RUNBOOK.md).`,
  }
}

export type LiveProbeOutcome = { status: 'blocked' | 'failed'; reason: string }

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL'])
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ENETDOWN', 'ECONNRESET', 'EPIPE'])
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT'])
const AUTH_REPLY_PATTERN = /^(WRONGPASS|NOAUTH|NOPERM)\b/
const CONNECT_TIMEOUT_PATTERN = /was not ready within|connect ETIMEDOUT|Connection is closed/

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  const queue: unknown[] = [error]
  while (queue.length > 0 && chain.length < 32) {
    const current = queue.shift()
    if (current === null || current === undefined || chain.includes(current)) continue
    chain.push(current)
    if (typeof current !== 'object') continue
    const record = current as { originalError?: unknown; cause?: unknown; previousErrors?: unknown; errors?: unknown; lastNodeError?: unknown }
    queue.push(record.originalError, record.cause, record.lastNodeError)
    if (Array.isArray(record.previousErrors)) queue.push(...record.previousErrors)
    if (Array.isArray(record.errors)) queue.push(...record.errors)
  }
  return chain
}

function codeOf(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

function authFailure(errors: unknown[]): string | null {
  for (const error of errors) {
    const match = messageOf(error).match(AUTH_REPLY_PATTERN)
    if (match) return `auth:${match[1]}`
  }
  return null
}

/**
 * Classify a failed readiness probe. Only an environment that cannot reach
 * the service — no credential from the identity source, DNS, network
 * unreachable, timeout — is `blocked`. Settings errors and auth rejections
 * (`WRONGPASS`/`NOAUTH`/`NOPERM`) from a reachable endpoint, TLS verification
 * failures and anything unrecognized are `failed`. `connectionErrors` are the
 * errors the client reported while connecting (an auth rejection there wins
 * over a later timeout). Reasons are stable codes only.
 */
export function classifyLiveProbeFailure(error: unknown, connectionErrors: unknown[] = []): LiveProbeOutcome {
  const chain = errorChain(error)
  const reported = connectionErrors.flatMap((entry) => errorChain(entry))
  for (const entry of chain) {
    if (isCacheProviderError(entry) && entry.code === 'invalid_settings') return { status: 'failed', reason: 'cache-provider:invalid_settings' }
  }
  const auth = authFailure([...chain, ...reported])
  if (auth) return { status: 'failed', reason: auth }
  if (chain.some((entry) => isManagedCredentialUnavailableError(entry))) return { status: 'blocked', reason: 'credentials:unavailable' }
  for (const entry of [...chain, ...reported]) {
    const code = codeOf(entry)
    if (code && DNS_CODES.has(code)) return { status: 'blocked', reason: 'network:dns' }
    if (code && UNREACHABLE_CODES.has(code)) return { status: 'blocked', reason: 'network:unreachable' }
    if (code && TIMEOUT_CODES.has(code)) return { status: 'blocked', reason: 'network:timeout' }
  }
  for (const entry of chain) {
    if ((isCacheProviderError(entry) && entry.code === 'timeout') || CONNECT_TIMEOUT_PATTERN.test(messageOf(entry))) return { status: 'blocked', reason: 'network:timeout' }
  }
  const first = chain[0]
  if (isCacheProviderError(first)) return { status: 'failed', reason: `cache-provider:${first.code}` }
  const code = chain.map(codeOf).find((value): value is string => value !== null)
  if (code) return { status: 'failed', reason: `error:${code}` }
  return { status: 'failed', reason: first instanceof Error ? first.name : 'unknown' }
}

export type LiveEvidence = {
  package: string
  version: string
  profile: string
  status: 'passed' | 'failed' | 'blocked'
  reason: string | null
  date: string
  runner: string | null
  tests: { total: number; passed: number; failed: number; skipped: number }
}

function packageManifest(packageDir: string): { name: string; version: string } {
  return JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as { name: string; version: string }
}

export function writeLiveEvidence(packageDir: string, evidence: Omit<LiveEvidence, 'package' | 'version' | 'date' | 'runner'>, env: LiveEnv = process.env): string {
  const manifest = packageManifest(packageDir)
  const dir = env[LIVE_EVIDENCE_DIR_ENV] || path.join(os.tmpdir(), 'om-cache-live-evidence')
  mkdirSync(dir, { recursive: true })
  const record: LiveEvidence = {
    package: manifest.name,
    version: manifest.version,
    date: new Date().toISOString(),
    runner: env[LIVE_RUNNER_REF_ENV] ?? env.GITHUB_RUN_ID ?? null,
    ...evidence,
  }
  const file = path.join(dir, `${evidence.profile}.json`)
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return file
}

/**
 * Final evidence status for a profile whose tests were collected: the probe
 * outcome when it failed, otherwise `passed` only if every test ran and passed.
 */
export function liveEvidenceStatus(probe: LiveProbeOutcome | null, counters: LiveEvidence['tests']): LiveEvidence['status'] {
  if (probe) return probe.status
  if (counters.failed > 0 || counters.passed === 0 || counters.passed < counters.total) return 'failed'
  return 'passed'
}

export type LiveProviderHarnessOptions = {
  packageDir: string
  /** The package's exported gated registration helper. */
  registration(options: EnterpriseCacheProviderRegistrationOptions): CacheProviderRegistration
  profiles: LiveProfile[]
  /** Defaults to `process.env`. */
  env?: LiveEnv
  /** Collection-time reachability check (defaults to a DNS + TCP probe). */
  reachability?: LiveReachabilityProbe
}

const GATE_OPEN = {
  OM_ENABLE_ENTERPRISE_MODULES: 'true',
  OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS: 'true',
} as const

type TestBody = () => unknown

function withItReplaced(replacement: (name: string, body: TestBody, timeout?: number) => void, register: () => void): void {
  const realIt = globalThis.it
  globalThis.it = Object.assign(replacement, realIt)
  try {
    register()
  } finally {
    globalThis.it = realIt
  }
}

/**
 * Protected live harness: container-free, driven only by an explicit approved
 * profile and the package's gated registration helper.
 *
 * - Not requested, unknown profile, missing env or an unreachable endpoint are
 *   decided at collection time: every live test is registered with `it.skip`
 *   (jest reports them skipped, never passed) and `blocked` evidence is written.
 * - Otherwise a readiness probe (identity + verified TLS + healthcheck) runs
 *   first. A probe failure fails every live test — never a silent pass: the
 *   evidence is `blocked` for an environment that turned out unavailable
 *   (credential source, network, timeout) and `failed` for everything else
 *   (settings, auth rejection, TLS).
 * - Evidence holds the profile id, stable codes and totals only.
 */
export function defineLiveProviderHarness(options: LiveProviderHarnessOptions): void {
  const env = options.env ?? process.env
  const providerId = options.registration({ settings: () => undefined }).id
  const readiness = readLiveCollectionReadiness(options.profiles, env, options.reachability)
  const label = `${providerId} live profile`

  if (readiness.state === 'not-requested') {
    describe(`${label} (set ${LIVE_PROFILE_ENV} in a protected job to run)`, () => {
      it.skip('is not requested', () => undefined)
    })
    return
  }

  const conformanceFor = (name: string, createService: Parameters<typeof defineCacheProviderConformance>[0]['createService']) => {
    defineCacheProviderConformance({ name, createService, supportsReturnExpired: false })
  }

  if (readiness.state === 'unknown-profile' || readiness.state === 'blocked') {
    const profileId = readiness.state === 'blocked' ? readiness.profile.id : 'unknown'
    const reason = readiness.state === 'blocked' ? readiness.reason : 'unknown-profile'
    const counters = { total: 0, passed: 0, failed: 0, skipped: 0 }
    describe(`${label}: ${profileId} — blocked (${reason}), not run`, () => {
      const realIt = globalThis.it
      withItReplaced((name, body, timeout) => {
        counters.total += 1
        counters.skipped += 1
        realIt.skip(name, async () => { await body() }, timeout)
      }, () => {
        globalThis.it('connects with the managed identity over verified TLS (probe)', () => undefined)
        conformanceFor(`${providerId} · ${profileId}`, async () => {
          throw new Error('[internal] blocked live profile must not open a service')
        })
      })
    })
    const file = writeLiveEvidence(options.packageDir, { profile: profileId, status: 'blocked', reason, tests: counters }, env)
    process.stdout.write(`[cache-live] ${readiness.message} — ${counters.total} live tests skipped (evidence: ${file})\n`)
    return
  }

  const profile = readiness.profile
  const namespacePrefix = env[LIVE_NAMESPACE_PREFIX_ENV]!.trim()
  const counters = { total: 0, passed: 0, failed: 0, skipped: 0 }
  let probe: LiveProbeOutcome | null = null

  const resolve = async (namespace: string): Promise<ResolvedCacheProvider<unknown>> => {
    const resolveEnv: CacheProviderEnv = { ...env, ...GATE_OPEN, CACHE_PROVIDER: providerId, CACHE_PROVIDER_NAMESPACE: namespace }
    const registration = options.registration({ settings: () => profile.settings(env), env: resolveEnv })
    const resolved = await resolveCacheProvider([registration], { env: resolveEnv })
    if (!resolved) throw new Error('[internal] live provider not selected')
    return resolved
  }

  const probeFailure = (outcome: LiveProbeOutcome): Error => new Error(
    `[cache-live] live profile ${profile.id} ${outcome.status} in the readiness probe (${outcome.reason}); `
      + (outcome.status === 'blocked'
        ? 'the environment could not reach the service, so the profile stays unverified (see RUNBOOK.md)'
        : 'the service rejected the configuration or credentials'),
  )

  describe(`${label}: ${profile.id}`, () => {
    jest.setTimeout(120_000)

    beforeAll(async () => {
      const connectionErrors: unknown[] = []
      const logger: CacheProviderLogger = {
        warn: (_message, meta) => void connectionErrors.push(meta?.error),
        error: (_message, meta) => void connectionErrors.push(meta?.error),
      }
      try {
        const resolved = await resolve(randomNamespace(`${namespacePrefix}-probe`))
        const strategy = await resolved.definition.create(resolved.config, { ...createCacheProviderHostContext(resolved), logger })
        try {
          await strategy.healthcheck?.()
        } finally {
          await strategy.close?.()
        }
      } catch (error) {
        probe = classifyLiveProbeFailure(error, connectionErrors.filter((entry) => entry !== undefined))
      }
    })

    afterAll(() => {
      const status = liveEvidenceStatus(probe, counters)
      const reason = probe ? probe.reason : null
      const file = writeLiveEvidence(options.packageDir, { profile: profile.id, status, reason, tests: counters }, env)
      process.stdout.write(`[cache-live] profile ${profile.id}: ${status}${reason ? ` (${reason})` : ''} (evidence: ${file})\n`)
    })

    const realIt = globalThis.it
    withItReplaced((name, body, timeout) => realIt(name, async () => {
      counters.total += 1
      const outcome: LiveProbeOutcome | null = probe
      if (outcome) {
        if (outcome.status === 'blocked') counters.skipped += 1
        else counters.failed += 1
        throw probeFailure(outcome)
      }
      try {
        await body()
        counters.passed += 1
      } catch (error) {
        counters.failed += 1
        throw error
      }
    }, timeout), () => {
      globalThis.it('connects with the managed identity over verified TLS (probe)', () => undefined)
      conformanceFor(`${providerId} · ${profile.id}`, async (namespace, serviceOptions) => createCacheService({
        provider: await resolve(`${namespacePrefix}-${namespace}`),
        ...(serviceOptions?.defaultTtl !== undefined ? { defaultTtl: serviceOptions.defaultTtl } : {}),
      }))
    })
  })
}
