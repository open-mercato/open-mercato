/**
 * The two contracts a workflow author touches: what goes INTO the voice node
 * and what comes OUT of it.
 *
 * Both are zod, and both are load-bearing beyond validation. The OUTCOME
 * envelope is what `defineExternalAgent` registers, which is what
 * `listAgentOutcomeContracts()` projects into the workflows context ledger —
 * so it is what makes `outputMapping: { call: 'data.collected.owner_decision' }`
 * typecheck in the Studio's variable picker instead of resolving to `unknown`.
 */

import { z } from 'zod'

/**
 * A dynamic-variable value as ElevenLabs accepts it. Anything richer an author
 * passes is JSON-serialised on the way out (see `buildDynamicVariables`) rather
 * than rejected — a brief assembled from an upstream agent's structured result
 * is the normal case, not an authoring mistake.
 */
export const dynamicVariableValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type DynamicVariableValue = z.infer<typeof dynamicVariableValueSchema>

/**
 * The node's `input`.
 *
 * `toNumber` is the only required field: every other knob has a per-tenant
 * default in the integration credential store, so the common authoring shape is
 * just `{ toNumber, brief }` and the tenant's ElevenLabs agent supplies the rest.
 */
export const voiceCallInputSchema = z.object({
  /** E.164 destination, e.g. `+48123456789`. */
  toNumber: z.string().trim().min(3),
  /**
   * The single free-text instruction the call is about. Travels as the
   * `{{brief}}` dynamic variable, which is what the ElevenLabs agent prompt
   * references.
   */
  brief: z.string().optional(),
  /**
   * Extra dynamic variables, merged under `brief`. Keys become `{{key}}` in the
   * ElevenLabs agent prompt. Keys in the reserved `om_` namespace are dropped —
   * see `RESERVED_DYNAMIC_VARIABLE_PREFIX`.
   */
  variables: z.record(z.string(), z.unknown()).optional(),
  /** Per-call override of the tenant's configured ElevenLabs agent. */
  agentId: z.string().trim().min(1).optional(),
  /** Per-call override of the tenant's configured phone number. */
  agentPhoneNumberId: z.string().trim().min(1).optional(),
  /** Per-call override of the tenant's telephony wiring; decides which endpoint is called. */
  telephonyProvider: z.enum(['twilio', 'sip_trunk']).optional(),
  /** Per-call override of recording. Regulated in most jurisdictions — see the connector docs. */
  callRecordingEnabled: z.boolean().optional(),
  /** `conversation_config_override.agent.first_message`. */
  firstMessage: z.string().optional(),
  /** `conversation_config_override.agent.language`, e.g. `'pl'`. */
  language: z.string().trim().min(2).optional(),
})

export type VoiceCallInput = z.infer<typeof voiceCallInputSchema>

/**
 * One turn of the conversation, flattened from ElevenLabs' `transcript[]`.
 *
 * `message` is nullable because a tool-call turn carries no spoken text.
 */
export const voiceCallTranscriptTurnSchema = z.object({
  role: z.string(),
  message: z.string().nullable(),
  timeInCallSecs: z.number().nullable(),
})

/** One `analysis.evaluation_criteria_results` entry: the verdict plus why. */
export const voiceCallCriterionSchema = z.object({
  result: z.string(),
  rationale: z.string().nullable(),
})

/**
 * The OUTCOME.
 *
 * `collected` is the valuable field and the reason this agent exists: it is
 * ElevenLabs' `analysis.data_collection_results`, flattened to `key -> value`.
 * That is the structured data the voice agent was configured to extract from the
 * human it spoke to, and it is what the next (native, proposal-kind) agent in the
 * graph reads. Everything else — the summary, the transcript, the criteria — is
 * evidence supporting it.
 */
export const voiceCallOutcomeSchema = z.object({
  /** ElevenLabs `conversation_id`; empty string only when a call failed before one was minted. */
  conversationId: z.string(),
  /**
   * Did we actually talk to a human? True only when the transcript contains at
   * least one non-empty `user` turn. A dialled-but-unanswered call, a voicemail
   * with no speech, and a call that never initiated are all `false`.
   */
  reached: z.boolean(),
  /** Provider status (`done`, `failed`, …) or `initiation_failed` for a `call_initiation_failure`. */
  status: z.string(),
  /** ElevenLabs' own verdict, `analysis.call_successful`. */
  callSuccessful: z.enum(['success', 'failure', 'unknown']),
  /** `analysis.transcript_summary`. */
  summary: z.string().nullable(),
  /** `analysis.data_collection_results` flattened to `key -> value`. */
  collected: z.record(z.string(), dynamicVariableValueSchema),
  /** `analysis.evaluation_criteria_results`, verdict + rationale per criterion. */
  criteria: z.record(z.string(), voiceCallCriterionSchema),
  /** The turn-by-turn transcript, in order. */
  transcript: z.array(voiceCallTranscriptTurnSchema),
  /** `metadata.call_duration_secs`. Voice minutes, not LLM tokens (design R8). */
  durationSeconds: z.number().nullable(),
  /** Populated only when the provider reported why the call did not happen. */
  failureReason: z.string().nullable(),
})

export type VoiceCallOutcome = z.infer<typeof voiceCallOutcomeSchema>

/**
 * The ENVELOPE, which is what `defineExternalAgent({ result })` takes and what
 * `connector.normalize()` must return — `resolveAgentOutcomeZod` reads the inner
 * `data` off it, and an agent that registers the inner shape by mistake silently
 * vanishes from the workflows ledger.
 */
export const voiceCallResultSchema = z.object({
  kind: z.literal('researcher'),
  data: voiceCallOutcomeSchema,
})

export type VoiceCallResult = z.infer<typeof voiceCallResultSchema>
