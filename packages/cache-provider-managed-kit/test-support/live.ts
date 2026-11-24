import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCacheProviderHostContext, defineCacheProviderRegistration, isCacheProviderError, resolveCacheProvider } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition, ResolvedCacheProvider } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderConformance, randomNamespace } from '@open-mercato/cache/testing/conformance'

export const LIVE_PROFILE_ENV = 'OM_CACHE_LIVE_PROFILE'
export const LIVE_NAMESPACE_PREFIX_ENV = 'OM_CACHE_LIVE_NAMESPACE_PREFIX'
export const LIVE_EVIDENCE_DIR_ENV = 'OM_CACHE_LIVE_EVIDENCE_DIR'
export const LIVE_RUNNER_REF_ENV = 'OM_CACHE_LIVE_RUNNER_REF'

export type LiveEnv = Record<string, string | undefined>

export type LiveProfile = {
  /** Generic profile id, e.g. `azure-nonclustered-entra-tls`. */
  id: string
  description: string
  /** Env variable names that must be present (values are never printed). */
  required: string[]
  optional: string[]
  /** Build raw provider settings from the env; reads only the declared names. */
  settings(env: LiveEnv): Record<string, unknown>
}

export type LiveReadiness =
  | { state: 'not-requested' }
  | { state: 'unknown-profile'; message: string }
  | { state: 'blocked'; profile: LiveProfile; message: string; missing: string[] }
  | { state: 'ready'; profile: LiveProfile }

/**
 * Decide whether a live profile can run. Messages name env variables and
 * profile ids only — never values, endpoints or identities.
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
      message: `live profile ${profile.id} is blocked: missing ${missing.join(', ')}. Supply them through the approved CI secret store or workload identity (see RUNBOOK.md); never on the command line, in Git or in chat.`,
    }
  }
  if (!/^[a-zA-Z0-9._-]{1,24}$/.test(env[LIVE_NAMESPACE_PREFIX_ENV]!.trim())) {
    return { state: 'blocked', profile, missing: [LIVE_NAMESPACE_PREFIX_ENV], message: `live profile ${profile.id} is blocked: ${LIVE_NAMESPACE_PREFIX_ENV} must be 1-24 letters, digits, ".", "_" or "-" (an owner-approved isolated test namespace prefix)` }
  }
  return { state: 'ready', profile }
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

function stableCode(error: unknown): string {
  if (isCacheProviderError(error)) return `cache-provider:${error.code}`
  if (error instanceof Error) return error.name
  return 'unknown'
}

/**
 * Protected live harness: container-free, driven only by an explicit approved
 * profile. Probes readiness (identity + verified TLS + healthcheck), then runs
 * the shared v1 conformance kit against the real managed service, counting
 * per-test results into a redacted evidence record (profile id, stable error
 * codes and totals only — no endpoints, identities or secrets).
 */
export function defineLiveProviderHarness(options: {
  packageDir: string
  provider: CacheProviderDefinition<unknown>
  profiles: LiveProfile[]
}): void {
  const readiness = readLiveReadiness(options.profiles)
  const label = `${options.provider.id} live profile`

  if (readiness.state === 'not-requested') {
    describe.skip(`${label} (set ${LIVE_PROFILE_ENV} in a protected job to run)`, () => {
      it('is not requested', () => undefined)
    })
    return
  }

  if (readiness.state === 'unknown-profile' || readiness.state === 'blocked') {
    describe(`${label}: blocked`, () => {
      it('records blocked evidence with a redacted, actionable reason', () => {
        const profile = readiness.state === 'blocked' ? readiness.profile.id : 'unknown'
        const file = writeLiveEvidence(options.packageDir, { profile, status: 'blocked', reason: readiness.state === 'blocked' ? `missing:${readiness.missing.join(',')}` : 'unknown-profile', tests: { total: 0, passed: 0, failed: 0, skipped: 0 } })
        process.stdout.write(`[cache-live] ${readiness.message} (evidence: ${file})\n`)
      })
    })
    return
  }

  const profile = readiness.profile
  const namespacePrefix = process.env[LIVE_NAMESPACE_PREFIX_ENV]!.trim()
  const counters = { total: 0, passed: 0, failed: 0, skipped: 0 }
  let blockedReason: string | null = null

  const resolve = async (namespace: string): Promise<ResolvedCacheProvider<unknown>> => {
    const registration = defineCacheProviderRegistration({ id: options.provider.id, load: async () => options.provider, settings: () => profile.settings(process.env) })
    const resolved = await resolveCacheProvider([registration], { env: { CACHE_PROVIDER: options.provider.id, CACHE_PROVIDER_NAMESPACE: namespace } })
    return resolved!
  }

  describe(`${label}: ${profile.id}`, () => {
    jest.setTimeout(120_000)
    const savedFlags = { modules: process.env.OM_ENABLE_ENTERPRISE_MODULES, providers: process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS }

    beforeAll(async () => {
      process.env.OM_ENABLE_ENTERPRISE_MODULES = 'true'
      process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS = 'true'
      try {
        const resolved = await resolve(randomNamespace(`${namespacePrefix}-probe`))
        const strategy = await resolved.definition.create(resolved.config, createCacheProviderHostContext(resolved))
        await strategy.healthcheck?.()
        await strategy.close?.()
      } catch (error) {
        blockedReason = stableCode(error)
      }
    })

    afterAll(() => {
      process.env.OM_ENABLE_ENTERPRISE_MODULES = savedFlags.modules
      process.env.OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS = savedFlags.providers
      const status = blockedReason ? 'blocked' : counters.failed > 0 ? 'failed' : 'passed'
      const file = writeLiveEvidence(options.packageDir, { profile: profile.id, status, reason: blockedReason, tests: counters })
      process.stdout.write(`[cache-live] profile ${profile.id}: ${status}${blockedReason ? ` (${blockedReason}; credentials or network unavailable — ${counters.skipped} live tests were not run and the profile stays unverified; see RUNBOOK.md)` : ''} (evidence: ${file})\n`)
    })

    const realIt = globalThis.it
    const countingIt = ((name: string, fn: () => unknown, timeout?: number) => realIt(name, async () => {
      counters.total += 1
      if (blockedReason) {
        counters.skipped += 1
        return
      }
      try {
        await fn()
        counters.passed += 1
      } catch (error) {
        counters.failed += 1
        throw error
      }
    }, timeout)) as unknown as jest.It
    globalThis.it = countingIt
    try {
      countingIt('connects with the managed identity over verified TLS (probe)', () => undefined)
      defineCacheProviderConformance({
      name: `${options.provider.id} · ${profile.id}`,
      createService: async (namespace, serviceOptions) => createCacheService({
        provider: await resolve(`${namespacePrefix}-${namespace}`),
        ...(serviceOptions?.defaultTtl !== undefined ? { defaultTtl: serviceOptions.defaultTtl } : {}),
      }),
      supportsReturnExpired: false,
      })
    } finally {
      globalThis.it = realIt
    }
  })
}
