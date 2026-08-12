/**
 * The ElevenLabs voice connector — the `ExternalAgentConnector` the agent
 * orchestrator drives.
 *
 * It owns exactly three things and nothing else: how to PLACE the call, how to
 * VERIFY the provider's callback, and how to RESHAPE the provider's payload. The
 * `AgentRun` row, the trace, the guardrails, the correlation row, the deadline
 * sweep, the workflow park/resume and the cockpit are all the platform's and are
 * identical for every connector.
 *
 * ─── HOW THE BRIEF TRAVELS ───────────────────────────────────────────────────
 *
 * ElevenLabs agents do not take a prompt per call. What they take is
 * `conversation_initiation_client_data.dynamic_variables`, a flat map that is
 * substituted into the agent's configured prompt wherever `{{name}}` appears.
 * So the node's `input` maps onto that map:
 *
 *   input.brief          → {{brief}}
 *   input.variables.foo  → {{foo}}
 *
 * plus the reserved `{{om_callback_url}}` (see below). An author therefore
 * writes their ElevenLabs agent prompt against `{{brief}}` and whatever keys
 * they put in `variables`, and nothing else needs to be agreed between the two
 * sides.
 *
 * ─── CANCEL IS DELIBERATELY NOT IMPLEMENTED ──────────────────────────────────
 *
 * The verified ElevenLabs Conversational AI surface has no hang-up / abort
 * endpoint for a live conversation. The nearest thing, deleting the conversation
 * record, would destroy the transcript and the audit trail WITHOUT ending the
 * call — a call that is still connected, still billing and now unattributed. So
 * `cancel` is omitted rather than faked: T2.7's sweep handles a connector without
 * one, logging an info line, expiring the run and waking the step down the
 * `error` handle. That is an honest "we stopped waiting", not a false
 * "we hung up".
 *
 * ─── MOCK IS DELIBERATELY NOT IMPLEMENTED ────────────────────────────────────
 *
 * A connector with no `mock` REFUSES on the dry-run and eval paths (T2.2), which
 * is the correct default for an effector that makes a phone ring: `evalReplayService`
 * calls `agentRuntime.run()` for real, so a mock that dialled would place one call
 * per replayed eval case, and a mock that fabricated a transcript would be graded
 * as though a human had said it. Eval/dry-run parity is T3.3's task.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import type {
  ExternalAgentConnector,
  ExternalAgentConnectorScope,
  ExternalAgentConnectorStartArgs,
  ExternalAgentConnectorStartResult,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import { voiceCallInputSchema, type VoiceCallInput } from '../data/validators'
import {
  OUTBOUND_CALL_PATHS,
  startOutboundCall,
  type ElevenLabsDynamicVariables,
  type ElevenLabsFetch,
  type OutboundCallRequestBody,
} from './api'
import {
  describeCredentialsForLog,
  redactSecrets,
  type ElevenLabsCredentials,
  type ElevenLabsTelephonyProvider,
} from './credentials'
import type { ReadElevenLabsCredentials } from './credentialsReader'
import { normalizeElevenLabsCallback } from './normalize'
import { ELEVENLABS_SIGNATURE_HEADER, verifyElevenLabsSignature } from './signature'

const logger = createLogger('agent_elevenlabs').child({ component: 'voice-connector' })

/** Stable connector id — referenced by `defineExternalAgent({ connectorId })` and by every correlation row. */
export const ELEVENLABS_VOICE_CONNECTOR_ID = 'elevenlabs.voice'

/**
 * Dynamic-variable keys this connector owns. An author-supplied variable in this
 * namespace is dropped rather than merged, so nothing a workflow interpolates
 * can overwrite the callback address.
 */
export const RESERVED_DYNAMIC_VARIABLE_PREFIX = 'om_'

/**
 * The platform's per-run callback URL, handed to ElevenLabs as a dynamic
 * variable.
 *
 * READ THIS BEFORE DEPLOYING. ElevenLabs' post-call webhook destination is
 * configured in the ElevenLabs workspace/agent settings, NOT in the
 * outbound-call request body — the verified request body has no webhook field.
 * The platform, on the other hand, mints a single-use per-run URL and expects
 * the provider to post to exactly that. The two do not meet on their own.
 *
 * Passing the URL as a reserved dynamic variable is what this connector can
 * honestly do inside the verified surface: it costs nothing, it makes the
 * per-run address visible in the conversation record for correlation and
 * debugging, and it is echoed back on the post-call payload under
 * `conversation_initiation_client_data`. It does NOT by itself make ElevenLabs
 * post there. A deployment must additionally point its ElevenLabs post-call
 * webhook at this deployment; until the provider supports a per-conversation
 * destination, that is an operator step, and it is called out in the
 * integration's help text.
 *
 * The value is a bearer credential (the callback token is in its path), so the
 * ElevenLabs agent prompt must never reference `{{om_callback_url}}` — a prompt
 * that does could speak it aloud.
 */
export const CALLBACK_URL_VARIABLE = 'om_callback_url'

export type ElevenLabsVoiceConnectorDeps = {
  readCredentials: ReadElevenLabsCredentials
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: ElevenLabsFetch
  /** Injected for tests; defaults to the wall clock. */
  nowMs?: () => number
  baseUrl?: string
}

export class ElevenLabsCallRejectedError extends Error {
  readonly code = 'ELEVENLABS_CALL_REJECTED'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'ElevenLabsCallRejectedError'
  }
}

export function createElevenLabsVoiceConnector(
  deps: ElevenLabsVoiceConnectorDeps,
): ExternalAgentConnector {
  const fetchImpl: ElevenLabsFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  const now = deps.nowMs ?? (() => Date.now())

  return {
    id: ELEVENLABS_VOICE_CONNECTOR_ID,

    async start(args: ExternalAgentConnectorStartArgs): Promise<ExternalAgentConnectorStartResult> {
      const input = parseVoiceCallInput(args.input, args.agentEntry.id)
      const credentials = await deps.readCredentials(args.scope)
      const telephonyProvider = resolveTelephonyProvider(input, credentials)

      const body = buildOutboundCallBody({ input, credentials, callbackUrl: args.callbackUrl })

      const response = await startOutboundCall({
        apiKey: credentials.apiKey,
        path: OUTBOUND_CALL_PATHS[telephonyProvider],
        body,
        fetchImpl,
        baseUrl: deps.baseUrl,
      })

      // A 200 with `success: false` is a REAL failure and the single easiest
      // thing to get wrong here: the HTTP layer succeeded, so an implementation
      // that only checked `response.ok` would park a workflow on a call that was
      // never placed, until the deadline sweep noticed half an hour later.
      if (!response.success) {
        throw new ElevenLabsCallRejectedError(
          // The provider's reason is worth surfacing, but its error bodies can
          // echo request material back, so it is redacted before it becomes a
          // stored failure reason.
          `ElevenLabs refused the outbound call: ${redactSecrets(response.message ?? 'no reason given', credentials)}`,
        )
      }
      // Same reasoning for a null conversation id: it is the only handle we have
      // on the call, and without it no callback could ever be correlated.
      const conversationId = response.conversation_id?.trim()
      if (!conversationId) {
        throw new ElevenLabsCallRejectedError(
          'ElevenLabs accepted the outbound call but returned no conversation_id',
        )
      }

      logger.info('placed an ElevenLabs outbound call', {
        agentId: args.agentEntry.id,
        conversationId,
        ...describeCredentialsForLog(credentials),
        // The destination number is PII and the callback URL carries a bearer
        // token; neither is logged.
      })

      // Returns as soon as the provider accepted the call. The answer arrives
      // minutes later on the callback route.
      return { externalRunId: conversationId, expectsCallback: true }
    },

    async verifyCallback(
      headers: Headers,
      rawBody: string,
      scope: ExternalAgentConnectorScope,
    ): Promise<boolean> {
      const credentials = await deps.readCredentials(scope)
      return verifyElevenLabsSignature({
        header: headers.get(ELEVENLABS_SIGNATURE_HEADER),
        // `rawBody` is the exact received body string. It is passed straight
        // through: re-serialising it here would break every real signature.
        rawBody,
        secret: credentials.webhookSecret,
        nowMs: now(),
      })
    },

    normalize(rawPayload: unknown): unknown {
      return normalizeElevenLabsCallback(rawPayload)
    },
  }
}

export function parseVoiceCallInput(input: unknown, agentId: string): VoiceCallInput {
  const parsed = voiceCallInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ElevenLabsCallRejectedError(
      `external agent "${agentId}" received an input that is not a voice-call request: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

/**
 * Twilio or SIP trunk, decided by an EXPLICIT setting rather than by inspecting
 * the phone-number id.
 *
 * An ElevenLabs `agent_phone_number_id` is an opaque provider identifier with no
 * documented, stable encoding of the carrier behind it, so any prefix- or
 * shape-based sniffing would be a guess that silently changes meaning the next
 * time ElevenLabs changes its id format. The per-call input override exists so a
 * tenant running both wirings can pick per workflow; the credential is the
 * default; and the credential parser's own fallback is `twilio`.
 *
 * The fallback is safe because the two options are different endpoints on the
 * same API: choosing wrongly yields a rejected request and a failed run, never a
 * call routed through the wrong carrier.
 */
function resolveTelephonyProvider(
  input: VoiceCallInput,
  credentials: ElevenLabsCredentials,
): ElevenLabsTelephonyProvider {
  return input.telephonyProvider ?? credentials.telephonyProvider
}

export function buildOutboundCallBody(args: {
  input: VoiceCallInput
  credentials: ElevenLabsCredentials
  callbackUrl: string
}): OutboundCallRequestBody {
  const { input, credentials } = args

  const configOverride = buildConversationConfigOverride(input)
  const callRecordingEnabled = input.callRecordingEnabled ?? credentials.callRecordingEnabled

  const body: OutboundCallRequestBody = {
    agent_id: input.agentId ?? credentials.agentId,
    agent_phone_number_id: input.agentPhoneNumberId ?? credentials.agentPhoneNumberId,
    to_number: input.toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: buildDynamicVariables(input, args.callbackUrl),
      ...(configOverride ? { conversation_config_override: configOverride } : {}),
    },
  }

  if (callRecordingEnabled !== null && callRecordingEnabled !== undefined) {
    body.call_recording_enabled = callRecordingEnabled
  }
  if (credentials.defaultCallerId) {
    body.telephony_call_config = { caller_id: credentials.defaultCallerId }
  }

  return body
}

/**
 * The brief, as ElevenLabs takes it.
 *
 * Author variables first, then `brief`, then the reserved keys — so the ordering
 * of the spread expresses the precedence, and the reserved namespace is filtered
 * out of the author's map before it is merged rather than overwritten
 * afterwards.
 */
export function buildDynamicVariables(
  input: VoiceCallInput,
  callbackUrl: string,
): ElevenLabsDynamicVariables {
  const variables: ElevenLabsDynamicVariables = {}

  for (const [key, value] of Object.entries(input.variables ?? {})) {
    if (key.startsWith(RESERVED_DYNAMIC_VARIABLE_PREFIX)) continue
    variables[key] = coerceDynamicVariable(value)
  }

  if (input.brief !== undefined) variables.brief = input.brief
  variables[CALLBACK_URL_VARIABLE] = callbackUrl

  return variables
}

/**
 * ElevenLabs dynamic variables are scalars. An author interpolating an upstream
 * agent's structured result into `variables` is normal, so a non-scalar is
 * serialised rather than rejected — dropping it would silently starve the
 * agent's prompt of the very context the workflow assembled.
 */
function coerceDynamicVariable(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function buildConversationConfigOverride(input: VoiceCallInput) {
  const agent: { first_message?: string; language?: string } = {}
  if (input.firstMessage !== undefined) agent.first_message = input.firstMessage
  if (input.language !== undefined) agent.language = input.language
  // Overrides must be enabled per field in the ElevenLabs agent's security
  // settings; an override the provider has not allowed is ignored on their side,
  // so sending it is inert rather than fatal.
  return Object.keys(agent).length ? { agent } : undefined
}
