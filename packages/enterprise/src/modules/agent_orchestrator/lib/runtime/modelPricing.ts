/**
 * Minimal per-model pricing config (data-honesty spec §3.2, gate decision Q8).
 *
 * Cost shown in the cockpit is an ESTIMATE computed from this table at run
 * completion (native) or trace ingestion (OpenCode/external), Langfuse-style —
 * stored on the run row, never recomputed at read time. The table is a
 * code-shipped default for the models this module actually routes to, with a
 * deploy-time override:
 *
 * - `OM_AGENT_MODEL_PRICING` — JSON `{ "<model>": { "inputPer1M": n, "outputPer1M": n, "cachedInputPer1M"?: n } }`
 *   merged over the defaults (bad JSON logs an internal warning and falls back).
 *   `cachedInputPer1M` is optional; without it cached input is priced at `inputPer1M`.
 * - `OM_AGENT_COST_CURRENCY` — ISO 4217 code for every computed estimate
 *   (default `USD`). One currency per deployment; no cross-currency conversion.
 *
 * Unknown model → `null` → `cost_minor` stays null → the UI renders `—`.
 * A tenant-scoped CRUD price table is deliberately future work (Q8: minimal).
 */

import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ component: 'model-pricing' })

export type ModelPrice = {
  /** Price per 1M input tokens, in major currency units (e.g. USD). */
  inputPer1M: number
  /** Price per 1M output tokens, in major currency units. */
  outputPer1M: number
  /**
   * Price per 1M CACHED input tokens (a prompt-cache read). Optional: when
   * absent, cached tokens are priced at `inputPer1M`.
   */
  cachedInputPer1M?: number
  currency: string
}

type PriceEntry = { inputPer1M: number; outputPer1M: number; cachedInputPer1M?: number }

/**
 * List prices per 1M tokens in USD — ESTIMATES as of 2026-07 for the model ids
 * the module's agents and provider presets actually declare (`claude-sonnet-4-5`
 * in the example agents; `gpt-5`/`gpt-5-mini`/`gpt-4o`/`gpt-4o-mini` provider
 * defaults). Cached-input rates are the providers' prompt-cache read prices
 * (0.1x input for Anthropic and the GPT-5 family, 0.5x for GPT-4o). Providers
 * reprice without notice: override via `OM_AGENT_MODEL_PRICING` rather than
 * waiting for a redeploy.
 */
const DEFAULT_PRICING: Record<string, PriceEntry> = {
  'gpt-5': { inputPer1M: 1.25, outputPer1M: 10, cachedInputPer1M: 0.125 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2, cachedInputPer1M: 0.025 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, cachedInputPer1M: 0.1 },
}

const DEFAULT_CURRENCY = 'USD'

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPriceEntry(value: unknown): value is PriceEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (entry.cachedInputPer1M !== undefined && !isNonNegativeFinite(entry.cachedInputPer1M)) return false
  return (
    typeof entry.inputPer1M === 'number' &&
    Number.isFinite(entry.inputPer1M) &&
    entry.inputPer1M >= 0 &&
    typeof entry.outputPer1M === 'number' &&
    Number.isFinite(entry.outputPer1M) &&
    entry.outputPer1M >= 0
  )
}

/**
 * Effective pricing table: env override merged over the code defaults. Parsed
 * lazily per call (mirrors `resolveNativeRunTimeoutMs`) so deployments and
 * tests can vary the env without a restart; malformed JSON or malformed
 * entries are skipped with an internal warning, never thrown.
 */
function resolvePricingTable(): Record<string, PriceEntry> {
  const raw = process.env.OM_AGENT_MODEL_PRICING
  if (!raw || raw.trim() === '') return DEFAULT_PRICING
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn('OM_AGENT_MODEL_PRICING is not a JSON object; using default pricing')
      return DEFAULT_PRICING
    }
    const merged: Record<string, PriceEntry> = { ...DEFAULT_PRICING }
    for (const [model, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPriceEntry(entry)) {
        merged[model] = {
          inputPer1M: entry.inputPer1M,
          outputPer1M: entry.outputPer1M,
          ...(entry.cachedInputPer1M !== undefined ? { cachedInputPer1M: entry.cachedInputPer1M } : {}),
        }
      } else logger.warn('OM_AGENT_MODEL_PRICING entry is malformed; ignored', { model })
    }
    return merged
  } catch {
    logger.warn('OM_AGENT_MODEL_PRICING is not valid JSON; using default pricing')
    return DEFAULT_PRICING
  }
}

/**
 * The deployment's cost-estimate currency (`OM_AGENT_COST_CURRENCY`, default
 * USD). Exported for read surfaces that label aggregated estimates.
 */
export function resolveCostCurrency(): string {
  const raw = process.env.OM_AGENT_COST_CURRENCY?.trim()
  return raw && /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : DEFAULT_CURRENCY
}
const resolveCurrency = resolveCostCurrency

/**
 * Resolve the price for a model id, tolerating the id shapes the stack
 * produces: exact (`gpt-5-mini`), slash-qualified (`openai/gpt-5-mini`,
 * `anthropic/claude-sonnet-4-5`), and date-suffixed upstream ids
 * (`claude-haiku-4-5-20251001`). Unknown model → null (never a guess).
 */
export function resolveModelPrice(model: string): ModelPrice | null {
  const table = resolvePricingTable()
  const currency = resolveCurrency()
  const candidates = new Set<string>()
  const trimmed = model.trim()
  if (!trimmed) return null
  candidates.add(trimmed)
  const afterSlash = trimmed.includes('/') ? trimmed.slice(trimmed.indexOf('/') + 1) : null
  if (afterSlash) candidates.add(afterSlash)
  for (const candidate of [trimmed, afterSlash]) {
    if (!candidate) continue
    const dateStripped = candidate.replace(/-\d{8}$/, '')
    if (dateStripped !== candidate) candidates.add(dateStripped)
  }
  for (const candidate of candidates) {
    const entry = table[candidate]
    if (entry) return { ...entry, currency }
  }
  return null
}

/**
 * The cached share is a SUBSET of input, so a stored value never exceeds the
 * known input total. Unknown stays unknown: null/undefined passes through.
 */
export function clampCachedInputTokens(
  cachedInputTokens: number | null | undefined,
  inputTokens: number | null | undefined,
): number | null | undefined {
  if (cachedInputTokens == null || inputTokens == null) return cachedInputTokens
  return Math.min(cachedInputTokens, inputTokens)
}

/**
 * Estimated run cost in minor currency units (cents), or null when the model
 * is unknown/absent or no token counts exist. Formula per the data-honesty
 * spec, with the cached tier split out of the input:
 * `round((freshTok × inputPer1M + cachedTok × (cachedInputPer1M ?? inputPer1M)
 *   + outTok × outputPer1M) / 1M × 100)`.
 *
 * `cachedInputTokens` is a SUBSET of `inputTokens` (clamped to `[0, inputTokens]`),
 * never an addition; null/absent means no cached share is known and the result
 * is identical to the two-tier formula. Prompt-cache WRITES are not split out:
 * they are priced at `inputPer1M` although some providers bill them higher
 * (Anthropic: 1.25x), so a cache-priming run is slightly under-estimated.
 */
export function computeCostMinor(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  cachedInputTokens?: number | null,
): { costMinor: number; currency: string } | null {
  if (!model) return null
  if (inputTokens == null && outputTokens == null) return null
  const price = resolveModelPrice(model)
  if (!price) return null
  const inTok = inputTokens ?? 0
  const outTok = outputTokens ?? 0
  const cachedTok = Math.min(Math.max(cachedInputTokens ?? 0, 0), inTok)
  const freshTok = inTok - cachedTok
  const cachedRate = price.cachedInputPer1M ?? price.inputPer1M
  const costMinor = Math.round(
    ((freshTok * price.inputPer1M + cachedTok * cachedRate + outTok * price.outputPer1M) / 1_000_000) * 100,
  )
  return { costMinor, currency: price.currency }
}
