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
 * ─── NAMED PROFILES DO NOT MULTIPLY WEBHOOK SETUP ────────────────────────────
 *
 * A tenant configures several call profiles (owner call, satisfaction survey,
 * payment chase) and each external agent names the one it dials with. That is a
 * START-side concern only: `ELEVENLABS_CALLBACK_PATH` is derived from the
 * CONNECTOR id and from nothing else, so however many profiles a tenant adds,
 * there is still exactly ONE URL to paste into the ElevenLabs workspace
 * settings. Making the callback address profile-dependent would put a manual
 * provider-side step behind every new profile, which is the cost profiles exist
 * to remove. Asserted in `__tests__/profiles.test.ts`.
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
 * ─── THE RECORDING IS BORROWED, NEVER TAKEN ──────────────────────────────────
 *
 * `fetchRecording` streams `GET /v1/convai/conversations/{id}/audio` through to
 * the operator who asked for it. No copy is stored: a recording is the caller's
 * VOICE, so storing one would make this deployment a second controller of
 * biometric-grade material for content nothing downstream reads. ElevenLabs
 * already retains it; the platform brokers access to it. The run-detail card
 * says so in as many words, because an operator who does not know where the
 * file lives cannot answer an erasure request about it.
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
import {
  buildExternalConnectorCallbackPath,
  type ExternalAgentConnector,
  type ExternalAgentConnectorScope,
  type ExternalAgentConnectorStartArgs,
  type ExternalAgentConnectorStartResult,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import { voiceCallInputSchema, type VoiceCallInput } from '../data/validators'
import {
  OUTBOUND_CALL_PATHS,
  fetchConversationAudio,
  startOutboundCall,
  type ElevenLabsDynamicVariables,
  type ElevenLabsFetch,
  type OutboundCallRequestBody,
} from './api'
import {
  describeCredentialsForLog,
  redactSecrets,
  resolveCallProfile,
  type ElevenLabsCallProfile,
  type ElevenLabsTelephonyProvider,
} from './credentials'
import type { ReadElevenLabsCredentials } from './credentialsReader'
import { extractElevenLabsConversationId, normalizeElevenLabsCallback } from './normalize'
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
 * The platform's per-run callback URL, echoed to ElevenLabs as a dynamic
 * variable. CORRELATION ONLY — it is not how an answer gets home.
 *
 * READ THIS BEFORE DEPLOYING. ElevenLabs' post-call webhook destination is
 * configured in the ElevenLabs workspace/agent settings, NOT in the
 * outbound-call request body — the verified request body has no webhook field.
 * So the platform's single-use per-run URL can never be delivered to ElevenLabs,
 * and nothing this connector puts in the call payload changes that.
 *
 * WHAT ACTUALLY SETTLES A RUN is the static, connector-addressed callback route
 * (tracker task 2.12): the operator pastes ONE URL —
 * `<APP_URL>` + `buildExternalConnectorCallbackPath('elevenlabs.voice')` — into
 * their ElevenLabs workspace (or agent) post-call webhook settings, once, and
 * every conversation's answer arrives there. That route finds the run by the
 * `conversation_id` in the payload (`extractExternalRunId`) and proves who sent
 * it with the per-tenant HMAC. On that route the HMAC is the ONLY credential
 * there is: the per-run token plays no part, so the webhook secret is what
 * stands between a stranger and a settled workflow.
 *
 * The variable is kept because it costs nothing and earns its place in
 * debugging: it makes the per-run address visible in the conversation record and
 * is echoed back on the post-call payload under
 * `conversation_initiation_client_data`, which is how an operator ties a
 * conversation in the ElevenLabs dashboard to a run here.
 *
 * The value is a bearer credential (the callback token is in its path), so the
 * ElevenLabs agent prompt must never reference `{{om_callback_url}}` — a prompt
 * that does could speak it aloud.
 */
export const CALLBACK_URL_VARIABLE = 'om_callback_url'

/**
 * The static URL an operator pastes into the ElevenLabs workspace/agent
 * post-call webhook settings, relative to the deployment's own origin. Built
 * from the platform's own path helper so the address in the help text can never
 * drift from the route that serves it.
 */
export const ELEVENLABS_CALLBACK_PATH = buildExternalConnectorCallbackPath(
  ELEVENLABS_VOICE_CONNECTOR_ID,
)

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
      // BEFORE THE DIAL, DELIBERATELY. An agent naming a profile the tenant has
      // not configured throws here, with nothing in flight and no HTTP request
      // made — the runner turns that into a failed run down the `error` handle.
      // Resolving it later, or falling back to `default`, would ring a real
      // person with the wrong agent's script.
      const profile = resolveCallProfile(credentials, {
        profileName: args.agentEntry.profile,
        agentId: args.agentEntry.id,
      })
      const telephonyProvider = resolveTelephonyProvider(input, profile)

      const body = buildOutboundCallBody({ input, profile, callbackUrl: args.callbackUrl })

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
        ...describeCredentialsForLog(credentials, profile),
        // The ids ACTUALLY sent, which differ from the profile's whenever the
        // workflow node supplied a per-call override — without these, a wrong
        // call is indistinguishable in the log from a right one.
        dialledAgentId: body.agent_id,
        dialledPhoneNumberId: body.agent_phone_number_id,
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

    /**
     * What makes this connector reachable at all (tracker task 2.12).
     *
     * ElevenLabs posts every tenant's answer to ONE workspace-level URL, so the
     * platform's per-run token never travels and the token-addressed callback
     * route can never be reached. Implementing this opts the connector in to the
     * static route, which resolves the run from the provider's own
     * `conversation_id` — the value `start()` returned as `externalRunId` — and
     * lets the per-tenant HMAC decide which tenant's run it settles.
     */
    extractExternalRunId(rawPayload: unknown): string | null {
      return extractElevenLabsConversationId(rawPayload)
    },

    /**
     * The recording, borrowed from ElevenLabs for one operator who asked.
     *
     * Nothing here writes, buffers or hashes the audio: the provider's response
     * body is handed back as a stream and the run-detail route pipes it. That is
     * the whole design — ElevenLabs stays the single controller of the caller's
     * voice, and this deployment holds no copy to erase, purge or leak.
     *
     * The API key is read per call from THIS tenant's credentials through the
     * caller's container, exactly as `start` and `verifyCallback` do; the
     * connector is process-global and never holds a secret.
     */
    async fetchRecording(externalRunId, scope) {
      const conversationId = externalRunId.trim()
      if (!conversationId) return null

      const credentials = await deps.readCredentials(scope)
      const response = await fetchConversationAudio({
        apiKey: credentials.apiKey,
        conversationId,
        fetchImpl: fetchImpl,
        baseUrl: deps.baseUrl,
      })
      // Null covers both "ElevenLabs has no recording for this conversation"
      // (404) and a 200 that somehow carried no body — neither is a fault, and
      // the route turns both into a readable "nothing to play".
      if (!response?.body) return null

      const declaredLength = Number(response.headers.get('content-length'))
      return {
        // The provider's own type, never inferred: a workspace configured for a
        // different codec would otherwise be served under a wrong label.
        mimeType: response.headers.get('content-type') ?? 'audio/mpeg',
        stream: response.body,
        contentLength: Number.isFinite(declaredLength) && declaredLength >= 0 ? declaredLength : null,
        // The conversation id is the operator's handle on the ElevenLabs
        // dashboard, so the downloaded file names itself after it.
        fileName: `elevenlabs-conversation-${conversationId}.mp3`,
      }
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
 * tenant running both wirings can pick per workflow; the resolved profile is the
 * default; and the credential parser's own fallback is `twilio`.
 *
 * The fallback is safe because the two options are different endpoints on the
 * same API: choosing wrongly yields a rejected request and a failed run, never a
 * call routed through the wrong carrier.
 */
function resolveTelephonyProvider(
  input: VoiceCallInput,
  profile: ElevenLabsCallProfile,
): ElevenLabsTelephonyProvider {
  return input.telephonyProvider ?? profile.telephonyProvider
}

/**
 * THE PRECEDENCE, spelled out field by field: a per-call `input.*` value wins
 * over the resolved profile, and the profile is the agent's named one or
 * `default` (`resolveCallProfile`). Full order:
 *
 *   per-call override  >  the agent's named profile  >  the `default` profile
 *
 * The per-call override is the ESCAPE HATCH and stays: an author who genuinely
 * needs a one-off agent id still has it. What profiles change is that it is no
 * longer the ONLY way to run more than one voice agent, so per-tenant provider
 * ids stop accumulating inside workflow definitions where nobody can rotate them.
 *
 * `defaultCallerId` has no per-call override on purpose: who is calling is a
 * tenant-level compliance decision (design R6), so it comes from the profile only.
 */
export function buildOutboundCallBody(args: {
  input: VoiceCallInput
  profile: ElevenLabsCallProfile
  callbackUrl: string
}): OutboundCallRequestBody {
  const { input, profile } = args

  const configOverride = buildConversationConfigOverride(input)
  const callRecordingEnabled = input.callRecordingEnabled ?? profile.callRecordingEnabled

  const body: OutboundCallRequestBody = {
    agent_id: input.agentId ?? profile.agentId,
    agent_phone_number_id: input.agentPhoneNumberId ?? profile.phoneNumberId,
    to_number: input.toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: buildDynamicVariables(input, args.callbackUrl),
      ...(configOverride ? { conversation_config_override: configOverride } : {}),
    },
  }

  if (callRecordingEnabled !== null && callRecordingEnabled !== undefined) {
    body.call_recording_enabled = callRecordingEnabled
  }
  if (profile.defaultCallerId) {
    body.telephony_call_config = { caller_id: profile.defaultCallerId }
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
