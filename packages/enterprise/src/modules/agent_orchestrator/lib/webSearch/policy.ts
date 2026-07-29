import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import {
  DEFAULT_POLICY,
  MODEL_ADAPTER_TIMEOUT_MS,
  resolvePolicy,
  searchPolicySchema,
  type SearchPolicy,
  type SearchPolicyInput,
} from '@open-mercato/web-research'

/** The adapter enabled by default; also the one that needs its own budget. */
const MODEL_ADAPTER_ID = 'model-native'

/** Module + key under which the per-tenant policy is stored. */
export const WEB_SEARCH_CONFIG_MODULE = 'agent_orchestrator'
export const WEB_SEARCH_CONFIG_NAME = 'web_search'

export type WebSearchGuardrails = {
  readonly allowDomains: readonly string[]
  readonly denyDomains: readonly string[]
  readonly searchesPerRun: number
  readonly fetchesPerRun: number
  readonly callsPerTenantPerMinute: number
  readonly maxFetchBytes: number
}

export type WebSearchSettings = {
  readonly policy: SearchPolicy
  readonly guardrails: WebSearchGuardrails
  /** Per-adapter options, keyed by adapter id. Secrets arrive already decrypted. */
  readonly adapterOptions: Readonly<Record<string, unknown>>
  readonly source: 'tenant' | 'instance'
}

const GUARDRAIL_DEFAULTS = {
  searchesPerRun: 20,
  fetchesPerRun: 40,
  callsPerTenantPerMinute: 120,
  maxFetchBytes: 128 * 1024,
} as const

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt((raw ?? '').trim(), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function domainList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

function csv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Instance-level defaults from `OM_WEB_SEARCH_*`. Adapters listed in
 * `OM_WEB_SEARCH_ADAPTERS` are enabled in that order; everything else stays off,
 * which is what keeps SERP scraping opt-in.
 */
export function resolveEnvSettings(env: NodeJS.ProcessEnv = process.env): {
  policy: SearchPolicyInput
  guardrails: WebSearchGuardrails
} {
  const enabled = csv(env.OM_WEB_SEARCH_ADAPTERS)
  const adapters = (enabled.length > 0 ? enabled : [MODEL_ADAPTER_ID]).map((id, index) => ({
    id,
    enabled: true,
    order: index,
    weight: 1,
    // The model adapter runs its own multi-step web search and measures around
    // 30s; under the generic budget it times out on every run, which is what
    // made the shipped default configuration return nothing at all.
    ...(id === MODEL_ADAPTER_ID ? { timeoutMs: MODEL_ADAPTER_TIMEOUT_MS } : {}),
  }))

  return {
    policy: {
      adapters,
      ...(env.OM_WEB_SEARCH_SETTLE_MODE
        ? { settleMode: env.OM_WEB_SEARCH_SETTLE_MODE as SearchPolicyInput['settleMode'] }
        : {}),
      concurrency: positiveInt(env.OM_WEB_SEARCH_CONCURRENCY, DEFAULT_POLICY.concurrency),
      minResults: positiveInt(env.OM_WEB_SEARCH_MIN_RESULTS, DEFAULT_POLICY.minResults),
      adapterTimeoutMs: positiveInt(env.OM_WEB_SEARCH_ADAPTER_TIMEOUT_MS, DEFAULT_POLICY.adapterTimeoutMs),
      softDeadlineMs: positiveInt(env.OM_WEB_SEARCH_SOFT_DEADLINE_MS, DEFAULT_POLICY.softDeadlineMs),
      hardDeadlineMs: positiveInt(env.OM_WEB_SEARCH_HARD_DEADLINE_MS, DEFAULT_POLICY.hardDeadlineMs),
      cacheTtlMs: positiveInt(env.OM_WEB_SEARCH_CACHE_TTL_MS, DEFAULT_POLICY.cacheTtlMs),
      lastResort: env.OM_WEB_SEARCH_LAST_RESORT ?? DEFAULT_POLICY.lastResort,
    },
    guardrails: {
      allowDomains: domainList(env.OM_WEB_SEARCH_ALLOW_DOMAINS),
      denyDomains: domainList(env.OM_WEB_SEARCH_DENY_DOMAINS),
      searchesPerRun: positiveInt(env.OM_WEB_SEARCH_RATE_PER_RUN, GUARDRAIL_DEFAULTS.searchesPerRun),
      fetchesPerRun: positiveInt(env.OM_WEB_FETCH_RATE_PER_RUN, GUARDRAIL_DEFAULTS.fetchesPerRun),
      callsPerTenantPerMinute: positiveInt(
        env.OM_WEB_SEARCH_RATE_PER_TENANT_PER_MINUTE,
        GUARDRAIL_DEFAULTS.callsPerTenantPerMinute,
      ),
      maxFetchBytes: positiveInt(env.OM_WEB_FETCH_MAX_BYTES, GUARDRAIL_DEFAULTS.maxFetchBytes),
    },
  }
}

export const guardrailsSchema = z.object({
  allowDomains: z.array(z.string()).optional(),
  denyDomains: z.array(z.string()).optional(),
  searchesPerRun: z.number().int().min(1).optional(),
  fetchesPerRun: z.number().int().min(1).optional(),
  callsPerTenantPerMinute: z.number().int().min(1).optional(),
  maxFetchBytes: z.number().int().min(1024).optional(),
})

/** Shape persisted under `agent_orchestrator` / `web_search`. */
export const storedSettingsSchema = searchPolicySchema.extend({
  guardrails: guardrailsSchema.optional(),
  adapterOptions: z.record(z.string(), z.unknown()).optional(),
})

type ModuleConfigServiceLike = {
  getRecord(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<{ value: unknown; source?: string } | null>
}

function resolveModuleConfig(container: AwilixContainer): ModuleConfigServiceLike | null {
  try {
    return container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    return null
  }
}

/**
 * Env is the deployment default; a tenant row overrides it. Reads never fail the
 * caller — an unreachable config store degrades to env, because losing web search
 * entirely is worse than losing per-tenant tuning.
 */
export async function resolveWebSearchSettings(
  container: AwilixContainer,
  tenantId: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebSearchSettings> {
  const base = resolveEnvSettings(env)
  const service = resolveModuleConfig(container)

  let stored: Record<string, unknown> | null = null
  let source: 'tenant' | 'instance' = 'instance'
  if (service) {
    try {
      const record = await service.getRecord(WEB_SEARCH_CONFIG_MODULE, WEB_SEARCH_CONFIG_NAME, {
        tenantId,
      })
      if (record && typeof record.value === 'object' && record.value !== null) {
        stored = record.value as Record<string, unknown>
        if (record.source === 'tenant') source = 'tenant'
      }
    } catch {
      stored = null
    }
  }

  const storedPolicy = stored ? searchPolicySchema.safeParse(stored) : null
  const policy = resolvePolicy({
    ...base.policy,
    ...(storedPolicy?.success ? storedPolicy.data : {}),
  })

  const storedGuardrails = (stored?.guardrails ?? {}) as Partial<WebSearchGuardrails>
  const adapterOptions = (stored?.adapterOptions ?? {}) as Record<string, unknown>

  return {
    policy,
    guardrails: {
      allowDomains: storedGuardrails.allowDomains ?? base.guardrails.allowDomains,
      denyDomains: storedGuardrails.denyDomains ?? base.guardrails.denyDomains,
      searchesPerRun: storedGuardrails.searchesPerRun ?? base.guardrails.searchesPerRun,
      fetchesPerRun: storedGuardrails.fetchesPerRun ?? base.guardrails.fetchesPerRun,
      callsPerTenantPerMinute:
        storedGuardrails.callsPerTenantPerMinute ?? base.guardrails.callsPerTenantPerMinute,
      maxFetchBytes: storedGuardrails.maxFetchBytes ?? base.guardrails.maxFetchBytes,
    },
    adapterOptions,
    source,
  }
}

export function hostnameOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Deny wins over allow; a non-empty allowlist is exclusive. Matching is exact
 * host or a dot-boundary suffix, so `example.com` covers `news.example.com` but
 * not `notexample.com`.
 */
export function isHostAllowed(hostname: string, guardrails: WebSearchGuardrails): boolean {
  const host = hostname.toLowerCase()
  const matches = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`)
  if (guardrails.denyDomains.some(matches)) return false
  if (guardrails.allowDomains.length > 0) return guardrails.allowDomains.some(matches)
  return true
}
