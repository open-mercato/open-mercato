/**
 * What an external run COST and how long the provider actually worked
 * (external-agent-invocation design §7, risk R8; tracker task 3.2).
 *
 * The problem R8 names: `lib/runtime/modelPricing.ts` prices LLM tokens, and a
 * voice call has none. Left alone, every external run renders `—` for cost and
 * `—` for latency forever, so a tenant placing a thousand calls a day can read
 * its agent spend nowhere. But the fix must not reach the other way either:
 * synthesising a token count from a transcript's length would put a fiction into
 * `input_tokens` / `output_tokens`, and those columns feed the per-agent rollups
 * — one fabricated number there is worse than an honest blank.
 *
 * So the platform stamps ONLY what a provider genuinely reports, and it learns it
 * through a provider-agnostic contract rather than by knowing anything about any
 * one provider.
 *
 * THE SEAM. A connector's `normalize()` already returns the agent's OUTCOME
 * envelope (`{ kind, data }`). It may now put ONE additional, reserved,
 * platform-owned sibling beside them:
 *
 *     { kind: 'researcher', data: { … }, usage: { costMinor, currency, durationMs } }
 *
 * `completeExternalRun` SPLITS that key off before the agent's schema ever sees
 * the payload, so:
 *
 *   - the agent's declared OUTCOME contract is untouched — the Studio's variable
 *     picker, `outputMapping`, the transcript artifact and every `{{context.*}}`
 *     reference see exactly what they saw before this existed;
 *   - an envelope schema written with `.strict()` still validates, because the
 *     reserved key is removed rather than tolerated;
 *   - a connector that reports nothing (every connector before this) is
 *     byte-for-byte unaffected: no key, no stamp, columns left null.
 *
 * WHY THE CONNECTOR CONVERTS, NOT THE PLATFORM. The units are the provider's
 * private knowledge and they differ wildly — ElevenLabs reports both a CREDIT
 * balance charge and a fiat total, a generic HTTP connector may report neither.
 * Only the provider's own package knows which of its numbers is money and which
 * currency that money is in, so the boundary carries the platform's own units
 * (integer minor currency units + an ISO-4217 code + milliseconds) and no
 * provider-shaped field ever crosses it.
 *
 * WHY THIS IS A LEAF. `normalize()` lives in a provider package, which is
 * imported by that package's `di.ts` and therefore loaded in EVERY process that
 * builds a container. Its module graph must not drag the settlement path
 * (guardrails, the agent registry, persistence) along with it, which is the same
 * reason T2.6 moved `hashCallbackToken` out of the runner. This file imports zod
 * and the logger and nothing else, so a connector can import the constant and the
 * type at no cost.
 */

import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ component: 'external-run-usage' })

/**
 * The reserved key a connector puts its usage report under, beside `kind` and
 * `data`.
 *
 * Exported as a constant because BOTH sides must agree on it and they live in
 * different packages: a provider package writes it, `completeExternalRun` reads
 * and strips it, and a typo in either would silently produce a run with no cost
 * rather than an error anyone would notice.
 */
export const EXTERNAL_RUN_USAGE_KEY = 'usage'

/**
 * What a connector may report about a settled external run.
 *
 * Every field is optional and every field is independent: a provider that knows
 * how long the call lasted but not what it cost reports only `durationMs`, and
 * the cost column stays null rather than becoming a zero.
 */
export type ExternalRunUsageReport = {
  /**
   * The run's real cost in INTEGER MINOR CURRENCY UNITS (cents), as the provider
   * billed it — never an estimate the platform derived.
   *
   * A reported `0` is stamped as `0`, because for a metered provider that is a
   * genuine fact (a call covered by free minutes, a discounted account). An
   * ABSENT cost is stamped as nothing at all and the column stays null, because
   * "we do not know" and "it was free" are different answers and the cockpit
   * renders exactly one of them as `—`.
   */
  costMinor?: number | null
  /** ISO-4217 code for `costMinor`. Required WITH a cost — an amount with no unit is not a cost. */
  currency?: string | null
  /**
   * How long the provider was actually working, in milliseconds — for a voice
   * call, the length of the conversation.
   *
   * NOT the wall clock from `start()` to the callback. See the note on
   * `EXTERNAL_RUN_LATENCY_SEMANTICS` in `completeExternalRun`.
   */
  durationMs?: number | null
}

/**
 * The subset of `RunUsageStamp` (`./persistence`) an external run can honestly
 * fill.
 *
 * Declared here rather than imported so this file stays a leaf; it is checked
 * against the real thing structurally at the `completeRun` call site. The token
 * fields are ABSENT BY CONSTRUCTION — there is no way to express them through
 * this type, which is the point: a future connector author cannot report a token
 * count for a phone call even by trying.
 */
export type ExternalRunUsageStamp = {
  costMinor?: number
  currency?: string
  latencyMs?: number
}

/**
 * The wire shape, validated against EXACTLY the constraints
 * `agent_orchestrator.runs.complete` enforces on the same columns
 * (`commands/runs.ts` → `runUsageStampSchema`).
 *
 * That alignment is the whole best-effort guarantee. The stamp is applied inside
 * the audited command that CLOSES the run, so a value the command's own zod would
 * reject would throw there — after the provider genuinely answered, at a point
 * where the correlation row is already claimed. The callback would 500, the
 * provider would redeliver, and the redelivery would find the spent claim and
 * never resume the parked step. A malformed cost figure would therefore strand a
 * live workflow. Screening here, against the same rules, means a bad report can
 * only ever degrade to "no stamp" — never to a failed settlement.
 */
const usageReportSchema = z.object({
  costMinor: z.number().int().nonnegative().nullish(),
  currency: z.string().trim().length(3).nullish(),
  durationMs: z.number().int().nonnegative().nullish(),
})

/** `safeParse` itself can throw on an input that resists property access; this cannot. */
function safeParseUsageReport(reported: unknown) {
  try {
    return usageReportSchema.safeParse(reported)
  } catch {
    return null
  }
}

/**
 * Read a connector's usage report into the columns the run row keeps.
 *
 * TOTAL: every input returns a stamp, including `undefined`, a string, an array,
 * a hostile object and a value whose property access throws. A connector's
 * report is not a settlement input — nothing about the run's outcome depends on
 * it — so there is no shape of it that may interrupt the settlement.
 */
export function readExternalRunUsageReport(
  reported: unknown,
  context: Record<string, unknown> = {},
): ExternalRunUsageStamp {
  const parsed = safeParseUsageReport(reported)
  if (!parsed) {
    // Only reachable for an exotic input (a proxy that throws on read). Reported
    // as a dropped report rather than a crash, with no value in the record.
    logger.warn('external run usage report could not be read; the run keeps null cost and latency', context)
    return {}
  }

  if (!parsed.success) {
    // FIELD NAMES ONLY, never values and never the zod message: a connector that
    // put the dialled number or a transcript fragment where a number belongs is
    // exactly the case that produces this line, and it must not be the reason a
    // phone number lands in the log.
    logger.warn('external run usage report did not match the reportable shape; it was dropped', {
      ...context,
      rejectedFields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'usage')))].sort(),
    })
    return {}
  }

  const stamp: ExternalRunUsageStamp = {}

  if (typeof parsed.data.durationMs === 'number') {
    stamp.latencyMs = parsed.data.durationMs
  }

  const currency = parsed.data.currency?.toUpperCase()
  if (typeof parsed.data.costMinor === 'number' && currency) {
    stamp.costMinor = parsed.data.costMinor
    stamp.currency = currency
  } else if (typeof parsed.data.costMinor === 'number' || currency) {
    // An amount with no currency would be rendered by `formatCostMinor` under an
    // assumed 'USD', and a currency with no amount renders nothing. Both halves
    // or neither — a half-reported cost is a connector defect worth seeing.
    logger.warn('external run usage report gave a cost without both an amount and a currency; no cost was stamped', {
      ...context,
      hasAmount: typeof parsed.data.costMinor === 'number',
      hasCurrency: Boolean(currency),
    })
  }

  return stamp
}

/**
 * Split a connector-normalized payload into the OUTCOME the agent declared and
 * the usage the provider reported.
 *
 * The outcome is returned with the reserved key REMOVED, so everything
 * downstream — the output guardrail, `entry.schema.safeParse`, the transcript
 * artifact, the workflow resume payload — sees the envelope the agent's author
 * declared and nothing else. A payload carrying no reserved key is returned
 * unchanged (identity, not a copy), which is what keeps every existing connector
 * byte-for-byte unaffected.
 */
export function separateExternalRunUsage(
  payload: unknown,
  context: Record<string, unknown> = {},
): { outcome: unknown; usage: ExternalRunUsageStamp } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { outcome: payload, usage: {} }
  }

  let reported: unknown
  try {
    if (!(EXTERNAL_RUN_USAGE_KEY in payload)) return { outcome: payload, usage: {} }
    reported = (payload as Record<string, unknown>)[EXTERNAL_RUN_USAGE_KEY]
  } catch {
    logger.warn('external run payload could not be inspected for a usage report', context)
    return { outcome: payload, usage: {} }
  }

  let outcome: unknown = payload
  try {
    const { [EXTERNAL_RUN_USAGE_KEY]: _reserved, ...rest } = payload as Record<string, unknown>
    outcome = rest
  } catch {
    // Unreachable for JSON data. If the payload cannot be copied, the ORIGINAL is
    // returned: validating an envelope with one extra key is a far better failure
    // than settling a run against a payload we could not read.
    logger.warn('external run payload could not be split from its usage report', context)
  }

  return { outcome, usage: readExternalRunUsageReport(reported, context) }
}
