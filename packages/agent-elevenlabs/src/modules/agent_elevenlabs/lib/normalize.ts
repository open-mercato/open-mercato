/**
 * Provider payload → the agent's declared OUTCOME envelope.
 *
 * Called by the callback route only AFTER the signature verified, so the input
 * is authentic — but it is still UNTRUSTED CONTENT (a human said it out loud),
 * which is why nothing here interprets it: it is reshaped, never summarised or
 * judged. Screening it as untrusted text is the downstream agent's input
 * guardrail (design §7 R5), which already runs.
 *
 * ElevenLabs delivers three post-call webhook types and this file handles each
 * as its own case:
 *
 *   post_call_transcription   the real answer  →  a full outcome
 *   call_initiation_failure   the call never happened  →  an outcome with reached=false
 *   post_call_audio           the recording only  →  THROWS (see below)
 *
 * All three also carry `data.conversation_id`, which is how the static
 * connector-addressed callback route finds the run at all — see
 * `extractElevenLabsConversationId` below.
 *
 * A `post_call_transcription` additionally carries the provider's own metering,
 * which this file reports under the reserved `usage` key
 * (`ExternalRunUsageReport`, tracker task 3.2) so the run row can show what the
 * call cost and how long it lasted. That key travels BESIDE the outcome, never
 * inside it: see `buildUsageReport`.
 */

import { z } from 'zod'
import type { ExternalRunUsageReport } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalRunUsage'
import {
  voiceCallOutcomeSchema,
  type DynamicVariableValue,
  type ElevenLabsNormalizedResult,
  type VoiceCallOutcome,
} from '../data/validators'

/**
 * Raised for a `post_call_audio` delivery.
 *
 * WHY THROWING IS THE HONEST ANSWER. `post_call_audio` carries a base64 mp3 and
 * no transcript, no analysis and no status — there is genuinely no OUTCOME in
 * it. Two orderings are possible:
 *
 *   - The normal one: transcription settled the run first. T2.4's single-shot
 *     claim then makes this delivery a no-op — the route classifies the throw as
 *     a connector failure, `completeExternalRun` answers `already_settled`, the
 *     row and the workflow are untouched, and the provider gets its 200. The only
 *     visible effect is one warn line per recorded call.
 *   - The rare one: audio arrives first. The run settles as FAILED and the step
 *     wakes down the `error` handle. That is worse than waiting, but it is much
 *     better than the alternative of returning a synthetic `reached: false`
 *     outcome, which would settle the run with a fabricated negative answer and
 *     make T2.4's claim DISCARD the real transcript when it arrived seconds
 *     later. A downstream planning agent acting on "we could not reach the
 *     owner" when we did is precisely the failure this seam must not produce.
 *
 * THE AUDIO DELIVERY HAS NOWHERE TO GO, PERMANENTLY. T3.1 decided the recording
 * is never stored here and T3.4 made it fetch-on-demand instead
 * (`fetchRecording`), so a `post_call_audio` body carries nothing this platform
 * wants: the operator reads the recording live from the provider whenever they
 * ask. The rare audio-first ordering above therefore still costs a run, and
 * closing it needs a SECOND connector member — one that lets a connector say
 * "this payload is not a settlement" so the route can 200 without claiming the
 * row. That is a real follow-up, deliberately not folded into the recording
 * member: the two answer different questions, and widening the connector
 * interface twice in one task would have made both harder to review.
 */
export class ElevenLabsAudioOnlyCallbackError extends Error {
  readonly code = 'ELEVENLABS_AUDIO_ONLY_CALLBACK'
  constructor() {
    super(
      '[internal] post_call_audio carries a recording but no transcript or analysis; the post_call_transcription callback is what settles this run',
    )
    this.name = 'ElevenLabsAudioOnlyCallbackError'
  }
}

export class ElevenLabsCallbackShapeError extends Error {
  readonly code = 'ELEVENLABS_CALLBACK_SHAPE'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'ElevenLabsCallbackShapeError'
  }
}

const transcriptTurnSchema = z.object({
  role: z.string().nullish(),
  message: z.string().nullish(),
  time_in_call_secs: z.number().nullish(),
})

const dataCollectionEntrySchema = z.object({
  value: z.unknown().optional(),
  rationale: z.string().nullish(),
})

const criterionEntrySchema = z.object({
  result: z.string().nullish(),
  rationale: z.string().nullish(),
})

const analysisSchema = z.object({
  transcript_summary: z.string().nullish(),
  call_successful: z.string().nullish(),
  data_collection_results: z.record(z.string(), dataCollectionEntrySchema).nullish(),
  evaluation_criteria_results: z.record(z.string(), criterionEntrySchema).nullish(),
})

const transcriptionPayloadSchema = z.object({
  type: z.literal('post_call_transcription'),
  event_timestamp: z.number().nullish(),
  data: z.object({
    agent_id: z.string().nullish(),
    conversation_id: z.string().nullish(),
    status: z.string().nullish(),
    transcript: z.array(transcriptTurnSchema).nullish(),
    metadata: z
      .object({
        /**
         * `.catch(null)` on both metering fields, and it is load-bearing rather
         * than tidy: without it a single malformed number here REJECTS THE WHOLE
         * PAYLOAD. zod refuses `NaN` for `z.number()`, so a provider-side metering
         * glitch would make `normalizeTranscription` throw, the route would settle
         * the run as a connector failure, the workflow would wake down the `error`
         * handle — and the transcript of a conversation that really happened would
         * be discarded, because of a number nothing downstream branches on. What a
         * call cost may never decide whether the call is readable.
         */
        call_duration_secs: z.number().nullish().catch(null),
        /**
         * "Total fiat cost of the conversation in USD, i.e. the sum of the LLM
         * price and the non-LLM platform price" — the ElevenLabs conversation
         * model's own words, verified against the live API reference on
         * 2026-08-13. Nullable there, so absent is a normal answer.
         *
         * NOT `metadata.cost`, which the same payload also carries (the
         * documented example shows `"cost": 296` for a 22-second call). That one
         * is the CREDIT charge against the workspace balance — an ElevenLabs
         * internal unit with no fixed exchange rate to any currency. Stamping it
         * into `cost_minor` beside a `currency` of `USD` would report a call as
         * costing $2.96 when it cost about five cents, and would do so silently,
         * in a column that feeds the tenant's spend KPI. Credits are therefore
         * deliberately not read at all.
         */
        cost_fiat: z.number().nullish().catch(null),
      })
      .nullish(),
    analysis: analysisSchema.nullish(),
  }),
})

const initiationFailurePayloadSchema = z.object({
  type: z.literal('call_initiation_failure'),
  data: z.object({
    agent_id: z.string().nullish(),
    conversation_id: z.string().nullish(),
    failure_reason: z.string().nullish(),
  }),
})

const audioPayloadSchema = z.object({ type: z.literal('post_call_audio') })

const callbackTypeSchema = z.object({ type: z.string() })

/**
 * The shallow read the STATIC callback route uses to find which run a payload
 * belongs to (`ExternalAgentConnector.extractExternalRunId`, tracker task 2.12).
 *
 * All three ElevenLabs post-call webhook types carry the same address in the
 * same place — `data.conversation_id` — which is exactly the value `start()`
 * returned as the run's `externalRunId`:
 *
 *   post_call_transcription   data.conversation_id   (the real answer)
 *   post_call_audio           data.conversation_id   (the recording)
 *   call_initiation_failure   data.conversation_id   (the call never happened)
 *
 * So the extractor deliberately does NOT switch on `type`: it reads the one
 * field, and a fourth webhook type ElevenLabs adds later still resolves to the
 * right run instead of being dropped as unaddressable. Deciding what to DO with
 * a payload stays `normalize`'s job, which does switch on `type` and is called
 * only after the signature verified.
 *
 * It runs on UNVERIFIED, merely size-bounded input, so it is total: every shape
 * that is not an object carrying a non-empty string there yields `null`, and
 * nothing throws. `null` means "this connector cannot address this payload",
 * which the route answers with a 400 — it never means "settle something else".
 */
const conversationIdSchema = z.object({
  data: z.object({ conversation_id: z.string() }),
})

export function extractElevenLabsConversationId(rawPayload: unknown): string | null {
  const parsed = conversationIdSchema.safeParse(rawPayload)
  if (!parsed.success) return null
  const conversationId = parsed.data.data.conversation_id.trim()
  return conversationId.length ? conversationId : null
}

/**
 * The connector's `normalize`. Returns the ENVELOPE (`{ kind, data }`), because
 * that is what `completeExternalRun` validates against `entry.schema`.
 */
export function normalizeElevenLabsCallback(rawPayload: unknown): ElevenLabsNormalizedResult {
  const envelope = callbackTypeSchema.safeParse(rawPayload)
  if (!envelope.success) {
    throw new ElevenLabsCallbackShapeError('callback payload has no "type" field')
  }

  switch (envelope.data.type) {
    case 'post_call_transcription':
      return normalizeTranscription(rawPayload)
    case 'call_initiation_failure':
      // No call happened, so there is nothing metered to report: no `usage` key,
      // and the run's cost and latency stay null rather than becoming zeros that
      // would read as "a free, instantaneous call".
      return { kind: 'researcher', data: normalizeInitiationFailure(rawPayload) }
    case 'post_call_audio':
      audioPayloadSchema.parse(rawPayload)
      throw new ElevenLabsAudioOnlyCallbackError()
    default:
      throw new ElevenLabsCallbackShapeError(
        `unsupported ElevenLabs callback type "${envelope.data.type}"`,
      )
  }
}

function normalizeTranscription(rawPayload: unknown): ElevenLabsNormalizedResult {
  const parsed = transcriptionPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    throw new ElevenLabsCallbackShapeError(
      `post_call_transcription payload does not match the documented shape: ${parsed.error.message}`,
    )
  }

  const { data } = parsed.data
  const analysis = data.analysis ?? {}
  const transcript = (data.transcript ?? []).map((turn) => ({
    role: turn.role ?? 'unknown',
    message: turn.message ?? null,
    timeInCallSecs: turn.time_in_call_secs ?? null,
  }))

  const outcome: VoiceCallOutcome = {
    conversationId: data.conversation_id ?? '',
    // "Reached" means a human spoke, not that the provider considered the call
    // complete: a voicemail box that recorded our agent's message is a `done`
    // conversation with no user turn, and the workflow branch that matters is
    // "did we actually talk to them".
    reached: transcript.some((turn) => turn.role === 'user' && Boolean(turn.message?.trim())),
    status: data.status ?? 'unknown',
    callSuccessful: normalizeCallSuccessful(analysis.call_successful),
    summary: analysis.transcript_summary ?? null,
    collected: flattenDataCollection(analysis.data_collection_results),
    criteria: flattenCriteria(analysis.evaluation_criteria_results),
    transcript,
    durationSeconds: data.metadata?.call_duration_secs ?? null,
    failureReason: null,
  }

  const usage = buildUsageReport(data.metadata)
  return {
    kind: 'researcher',
    data: voiceCallOutcomeSchema.parse(outcome),
    // Spread conditionally: a payload reporting neither a duration nor a fiat
    // cost carries no `usage` key at all, which is how the platform tells "the
    // provider said nothing" from "the provider said zero".
    ...(usage ? { usage } : {}),
  }
}

/**
 * The provider's own metering, converted to the PLATFORM's units.
 *
 * This function is the whole reason `completeExternalRun` never learns an
 * ElevenLabs field name: seconds become milliseconds and USD dollars become
 * integer cents here, in the package that knows what ElevenLabs means, and what
 * crosses the boundary is the connector-agnostic `ExternalRunUsageReport`.
 *
 * Every conversion is defensive about what a webhook can actually contain — the
 * schema types these as numbers, but `NaN`, `Infinity` and negatives all satisfy
 * `z.number()` and any of them would be rejected downstream (or, worse, stored).
 * A value that is not a finite, non-negative number is simply not reported.
 */
function buildUsageReport(
  metadata: { call_duration_secs?: number | null; cost_fiat?: number | null } | null | undefined,
): ExternalRunUsageReport | null {
  const report: ExternalRunUsageReport = {}

  const durationSeconds = metadata?.call_duration_secs
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    report.durationMs = Math.round(durationSeconds * 1000)
  }

  const costFiat = metadata?.cost_fiat
  if (typeof costFiat === 'number' && Number.isFinite(costFiat) && costFiat >= 0) {
    // Rounded to the cent because that is the column's granularity, exactly as
    // `modelPricing.computeCostMinor` rounds a native run's estimate. A REPORTED
    // zero is kept as zero on purpose: for a call covered by free minutes or a
    // discounted account that is the true amount the tenant was charged, and it
    // is a different fact from the null an unreported cost leaves behind.
    report.costMinor = Math.round(costFiat * 100)
    report.currency = ELEVENLABS_COST_CURRENCY
  }

  return Object.keys(report).length > 0 ? report : null
}

/**
 * `cost_fiat` is documented as USD and there is no field naming another currency,
 * so the code is a constant rather than something read from the payload — reading
 * it would imply a choice ElevenLabs does not offer.
 */
const ELEVENLABS_COST_CURRENCY = 'USD'

function normalizeInitiationFailure(rawPayload: unknown): VoiceCallOutcome {
  const parsed = initiationFailurePayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    throw new ElevenLabsCallbackShapeError(
      `call_initiation_failure payload does not match the documented shape: ${parsed.error.message}`,
    )
  }

  // Deliberately a VALID researcher answer rather than a thrown connector
  // failure. "We could not place the call" is a fact about the world the
  // workflow asked us to establish, and the author branches on it with
  // `{{context.call.reached}}`. Routing it to the `error` handle instead would
  // hand them an untyped failure string and lose the reason.
  return voiceCallOutcomeSchema.parse({
    conversationId: parsed.data.data.conversation_id ?? '',
    reached: false,
    status: 'initiation_failed',
    callSuccessful: 'failure',
    summary: null,
    collected: {},
    criteria: {},
    transcript: [],
    durationSeconds: null,
    failureReason: parsed.data.data.failure_reason ?? 'call initiation failed',
  })
}

function normalizeCallSuccessful(value: string | null | undefined): 'success' | 'failure' | 'unknown' {
  if (value === 'success' || value === 'failure') return value
  return 'unknown'
}

/**
 * `analysis.data_collection_results` is `key -> { value, rationale, … }`.
 *
 * It is flattened to `key -> value` because that is what an author maps:
 * `outputMapping: { decision: 'data.collected.owner_decision' }` must yield the
 * decision, not an object wrapping it. The rationale is not dropped from the run
 * — the transcript and the summary carry the same evidence — it is just not what
 * the next node consumes.
 */
function flattenDataCollection(
  results: Record<string, { value?: unknown; rationale?: string | null }> | null | undefined,
): Record<string, DynamicVariableValue> {
  const collected: Record<string, DynamicVariableValue> = {}
  for (const [key, entry] of Object.entries(results ?? {})) {
    collected[key] = coerceCollectedValue(entry?.value)
  }
  return collected
}

function flattenCriteria(
  results: Record<string, { result?: string | null; rationale?: string | null }> | null | undefined,
): Record<string, { result: string; rationale: string | null }> {
  const criteria: Record<string, { result: string; rationale: string | null }> = {}
  for (const [key, entry] of Object.entries(results ?? {})) {
    criteria[key] = {
      result: entry?.result ?? 'unknown',
      rationale: entry?.rationale ?? null,
    }
  }
  return criteria
}

/**
 * A collected value is whatever the ElevenLabs agent's JSON schema declared.
 * Scalars pass through; anything structured is serialised rather than dropped,
 * so an author who configured an object-valued field still receives it.
 */
function coerceCollectedValue(value: unknown): DynamicVariableValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}
