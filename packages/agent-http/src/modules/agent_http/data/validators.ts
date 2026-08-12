/**
 * What a workflow node may send this connector, and what it gets back.
 *
 * ─── WHAT IS DELIBERATELY ABSENT FROM THE INPUT ──────────────────────────────
 *
 * There is NO per-call URL, header or signing override, and that is the single
 * most important line in this file. Everything about WHERE the request goes comes
 * from the tenant's integration credentials, because a workflow definition is
 * authored material: it is edited in the Studio, it can be drafted by an AI agent
 * and it is interpolated from run context. A `url` field here would turn a
 * credential-bearing outbound POST into an SSRF gadget that any definition author
 * — or any prompt that reaches the draft agent — could aim, and the shared URL
 * guard cannot help, because the target would be attacker-chosen but perfectly
 * public. The escape hatch for "this agent talks to a different service" is a
 * second registered connector, not a field.
 */

import { z } from 'zod'

/**
 * The node input. `.strict()` so a mistyped key is a named failure BEFORE
 * anything is posted, rather than a silently missing template value the provider
 * discovers as an empty brief.
 */
export const httpAgentInputSchema = z
  .object({
    /** The question, in one string. Reachable from the body template as `{{input.brief}}`. */
    brief: z.string().trim().min(1).optional(),
    /** Anything else the template needs, reachable as `{{input.payload.<key>}}`. */
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export type HttpAgentInput = z.infer<typeof httpAgentInputSchema>

/** The OUTCOME this connector can always produce, whatever the provider looks like. */
export const httpAgentOutcomeSchema = z.object({
  /**
   * The value found at the tenant's configured `resultPath`. One string, because
   * that is the only shape a connector with no provider knowledge can promise —
   * and because the Studio's variable picker types `data.answer` from exactly
   * this schema, so widening it to `unknown` would make every downstream
   * `{{context.*}}` reference untyped.
   */
  answer: z.string(),
})

export type HttpAgentOutcome = z.infer<typeof httpAgentOutcomeSchema>

/**
 * The ENVELOPE, which is what `defineExternalAgent({ result: { schema } })` takes
 * — `resolveAgentOutcomeZod` reads the inner `data` off it, and an agent passing
 * the inner shape by mistake silently vanishes from the workflows ledger.
 */
export const httpAgentResultSchema = z.object({
  kind: z.literal('researcher'),
  data: httpAgentOutcomeSchema,
})

export type GenericHttpCallResult = z.infer<typeof httpAgentResultSchema>
