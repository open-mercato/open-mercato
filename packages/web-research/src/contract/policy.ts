import { z } from 'zod'

export type SettleMode = 'race' | 'quorum' | 'exhaustive'

export type AdapterPolicyEntry = {
  readonly id: string
  readonly enabled: boolean
  readonly order: number
  /** Relative pull in the fusion step; higher trusts this adapter's ranking more. */
  readonly weight: number
  /**
   * Overrides `adapterTimeoutMs` for this adapter alone. Latency is not uniform
   * across kinds: a SERP read finishes in about a second, while a model doing its
   * own multi-step web search takes tens of seconds. One shared budget has to be
   * either too tight for the model or too slack for everything else.
   */
  readonly timeoutMs?: number
  /**
   * Ceiling on how often this adapter may be called, per tenant, per hour.
   *
   * The engine does not enforce this — it is per-request and has no memory. The
   * host counts calls and simply stops enabling the adapter once the ceiling is
   * reached, which is why the knob lives on the policy rather than in the engine.
   * Undefined means no ceiling.
   */
  readonly maxCallsPerHour?: number
}

export type ContentPolicy = {
  readonly enabledByDefault: boolean
  readonly maxPages: number
  readonly maxBytesPerPage: number
}

export type SearchPolicy = {
  readonly settleMode: SettleMode
  readonly concurrency: number
  readonly minResults: number
  readonly minAdapters: number
  readonly minConfidence: number
  readonly softDeadlineMs: number
  readonly hardDeadlineMs: number
  readonly adapterTimeoutMs: number
  readonly maxPerDomain: number
  readonly cacheTtlMs: number
  /**
   * Adapter run when every wave is exhausted and the fused set is still short,
   * even if it is disabled in the normal order. This is what makes "the engine
   * always returns something" true rather than aspirational.
   */
  readonly lastResort: string | null
  readonly escalateToBrowser: boolean
  readonly content: ContentPolicy
  readonly adapters: readonly AdapterPolicyEntry[]
}

/**
 * Budget for `model-native`, the adapter enabled by default. It runs the model's
 * own multi-step web search, which measures at roughly 30s end to end, so the
 * generic adapter budget would time it out on every single run and the shipped
 * configuration could never return anything.
 */
export const MODEL_ADAPTER_TIMEOUT_MS = 45_000

export const DEFAULT_POLICY: SearchPolicy = {
  settleMode: 'quorum',
  concurrency: 2,
  minResults: 5,
  minAdapters: 1,
  minConfidence: 0,
  // The soft deadline only binds once results exist, so a fast adapter still
  // settles the run in about a second; this ceiling is what a lone slow adapter
  // is allowed to use, not what a normal search costs.
  softDeadlineMs: 6_000,
  hardDeadlineMs: 60_000,
  adapterTimeoutMs: 8_000,
  maxPerDomain: 3,
  cacheTtlMs: 900_000,
  lastResort: 'model-native',
  escalateToBrowser: true,
  content: { enabledByDefault: false, maxPages: 3, maxBytesPerPage: 128 * 1024 },
  adapters: [],
}

export const adapterPolicyEntrySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  weight: z.number().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(250).max(120_000).optional(),
  maxCallsPerHour: z.number().int().min(1).max(1_000_000).optional(),
})

export const searchPolicySchema = z.object({
  settleMode: z.enum(['race', 'quorum', 'exhaustive']).optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  minResults: z.number().int().min(1).max(50).optional(),
  minAdapters: z.number().int().min(1).max(16).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  softDeadlineMs: z.number().int().min(250).max(120_000).optional(),
  hardDeadlineMs: z.number().int().min(500).max(180_000).optional(),
  adapterTimeoutMs: z.number().int().min(250).max(120_000).optional(),
  maxPerDomain: z.number().int().min(1).max(50).optional(),
  cacheTtlMs: z.number().int().min(0).max(86_400_000).optional(),
  lastResort: z.string().min(1).nullable().optional(),
  escalateToBrowser: z.boolean().optional(),
  content: z
    .object({
      enabledByDefault: z.boolean().optional(),
      maxPages: z.number().int().min(0).max(20).optional(),
      maxBytesPerPage: z.number().int().min(1024).max(4 * 1024 * 1024).optional(),
    })
    .optional(),
  adapters: z.array(adapterPolicyEntrySchema).optional(),
})

export type SearchPolicyInput = z.infer<typeof searchPolicySchema>

/**
 * Merges a partial policy over the defaults. Deadlines are reconciled rather
 * than trusted: a soft deadline past the hard one would make the scheduler wait
 * for a barrier it can never reach.
 */
export function resolvePolicy(input: SearchPolicyInput | null | undefined): SearchPolicy {
  const patch = input ?? {}
  const hardDeadlineMs = patch.hardDeadlineMs ?? DEFAULT_POLICY.hardDeadlineMs
  const softDeadlineMs = Math.min(patch.softDeadlineMs ?? DEFAULT_POLICY.softDeadlineMs, hardDeadlineMs)
  return {
    settleMode: patch.settleMode ?? DEFAULT_POLICY.settleMode,
    concurrency: patch.concurrency ?? DEFAULT_POLICY.concurrency,
    minResults: patch.minResults ?? DEFAULT_POLICY.minResults,
    minAdapters: patch.minAdapters ?? DEFAULT_POLICY.minAdapters,
    minConfidence: patch.minConfidence ?? DEFAULT_POLICY.minConfidence,
    softDeadlineMs,
    hardDeadlineMs,
    adapterTimeoutMs: Math.min(patch.adapterTimeoutMs ?? DEFAULT_POLICY.adapterTimeoutMs, hardDeadlineMs),
    maxPerDomain: patch.maxPerDomain ?? DEFAULT_POLICY.maxPerDomain,
    cacheTtlMs: patch.cacheTtlMs ?? DEFAULT_POLICY.cacheTtlMs,
    lastResort: patch.lastResort === undefined ? DEFAULT_POLICY.lastResort : patch.lastResort,
    escalateToBrowser: patch.escalateToBrowser ?? DEFAULT_POLICY.escalateToBrowser,
    content: {
      enabledByDefault: patch.content?.enabledByDefault ?? DEFAULT_POLICY.content.enabledByDefault,
      maxPages: patch.content?.maxPages ?? DEFAULT_POLICY.content.maxPages,
      maxBytesPerPage: patch.content?.maxBytesPerPage ?? DEFAULT_POLICY.content.maxBytesPerPage,
    },
    adapters: (patch.adapters ?? []).map((entry, index) => ({
      id: entry.id,
      enabled: entry.enabled ?? true,
      order: entry.order ?? index,
      weight: entry.weight ?? 1,
      // Clamped to the hard deadline for the same reason the shared budget is:
      // a per-adapter timeout past it can never be reached.
      ...(entry.timeoutMs === undefined ? {} : { timeoutMs: Math.min(entry.timeoutMs, hardDeadlineMs) }),
      ...(entry.maxCallsPerHour === undefined ? {} : { maxCallsPerHour: entry.maxCallsPerHour }),
    })),
  }
}
