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
import { adapterSecretFields, decryptAdapterSecrets } from './secretStorage'

/** The adapter enabled by default; also the one that needs its own budget. */
const MODEL_ADAPTER_ID = 'model-native'

/** Module + key under which the per-tenant policy is stored. */
export const WEB_SEARCH_CONFIG_MODULE = 'agent_orchestrator'
export const WEB_SEARCH_CONFIG_NAME = 'web_search'

export type WebSearchGuardrails = {
  readonly allowDomains: readonly string[]
  readonly denyDomains: readonly string[]
  /**
   * Hosts allowed to resolve to a non-public address.
   *
   * Egress, not filtering: `allowDomains`/`denyDomains` decide which results an
   * agent may see, this decides where the engine may connect at all. It exists so
   * an operator-hosted service — a SearXNG instance on the container network — is
   * reachable, which the SSRF guard otherwise refuses by design.
   *
   * Naming a host here also makes it reachable by `web_fetch`. Pair it with
   * `denyDomains` when only an adapter should be able to talk to it.
   */
  readonly allowPrivateHosts: readonly string[]
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
      allowPrivateHosts: domainList(env.OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS),
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

/**
 * Backfills the model adapter's budget on a policy that did not name one.
 *
 * A stored adapter list replaces the env-derived one outright, so every tenant
 * who ever saved from the settings page has a `model-native` row with no
 * `timeoutMs` — and the shared 8s budget times it out on every run, which is the
 * whole failure this default exists to prevent. An explicit value is left alone:
 * an operator who chose one owns it.
 */
export function withModelAdapterBudget(policy: SearchPolicy): SearchPolicy {
  const needsBudget = policy.adapters.some(
    (entry) => entry.id === MODEL_ADAPTER_ID && entry.timeoutMs === undefined,
  )
  if (!needsBudget) return policy
  return {
    ...policy,
    hardDeadlineMs: Math.max(policy.hardDeadlineMs, MODEL_ADAPTER_TIMEOUT_MS),
    adapters: policy.adapters.map((entry) =>
      entry.id === MODEL_ADAPTER_ID && entry.timeoutMs === undefined
        ? { ...entry, timeoutMs: MODEL_ADAPTER_TIMEOUT_MS }
        : entry,
    ),
  }
}

/**
 * The guardrails a TENANT may store.
 *
 * `allowPrivateHosts` is deliberately absent. Naming a host there lets an
 * adapter — and `web_fetch` — resolve to a private address, which widens the
 * deployment's egress boundary past the SSRF guard. That is an operator
 * decision about the network the app runs in, not a per-tenant preference, so
 * it lives in `OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS` only. A tenant admin with
 * `agents.manage` could otherwise point the fetcher at the cloud metadata
 * endpoint from a settings form.
 *
 * The field is not merely ignored on write — it is not in the schema, so a body
 * carrying it is REJECTED rather than silently accepted. Silent acceptance
 * would leave an operator believing they had set something.
 */
export const guardrailsSchema = z.object({
  allowDomains: z.array(z.string()).optional(),
  denyDomains: z.array(z.string()).optional(),
  searchesPerRun: z.number().int().min(1).optional(),
  fetchesPerRun: z.number().int().min(1).optional(),
  callsPerTenantPerMinute: z.number().int().min(1).optional(),
  maxFetchBytes: z.number().int().min(1024).optional(),
}).strict()

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
  const merged = resolvePolicy({
    ...base.policy,
    ...(storedPolicy?.success ? storedPolicy.data : {}),
  })
  const policy = withModelAdapterBudget(merged)

  const storedGuardrails = (stored?.guardrails ?? {}) as Partial<WebSearchGuardrails>
  // Adapter credentials are encrypted at rest (see `secretStorage.ts`). Every
  // consumer — the engine, the health probe, the preview, the settings form —
  // comes through here, so decrypting once at this seam is what keeps a second
  // reader from acquiring its own copy of the rule.
  const adapterOptions = await decryptAdapterSecrets(
    container,
    tenantId,
    (stored?.adapterOptions ?? {}) as Record<string, unknown>,
    adapterSecretFields(container),
  )

  return {
    policy,
    guardrails: {
      allowDomains: storedGuardrails.allowDomains ?? base.guardrails.allowDomains,
      denyDomains: storedGuardrails.denyDomains ?? base.guardrails.denyDomains,
      // Env only, never the stored row — see `guardrailsSchema`. Reading a
      // stored value here would reopen the hole the schema closes for any row
      // written before the field was removed.
      allowPrivateHosts: base.guardrails.allowPrivateHosts,
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
