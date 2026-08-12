/**
 * The ElevenLabs Conversational AI HTTP surface this package uses, verified
 * against the live docs on 2026-08-12.
 *
 *   POST /v1/convai/twilio/outbound-call      start a call on a Twilio-backed number
 *   POST /v1/convai/sip-trunk/outbound-call   start a call on a SIP-trunk number
 *   GET  /v1/convai/conversations/{id}        poll / backfill one conversation
 *   GET  /v1/convai/conversations/{id}/audio  the recording
 *
 * Auth is the `xi-api-key` header on every request.
 *
 * Nothing here throws an error containing the API key, and nothing logs. The
 * caller decides what is worth reporting; this file only speaks HTTP.
 */

import { z } from 'zod'

export const ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io'

/** Overridable per deployment for a proxy or a regional endpoint. */
export const ELEVENLABS_API_BASE_URL_ENV = 'OM_INTEGRATION_ELEVENLABS_API_BASE_URL'

export function resolveElevenLabsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[ELEVENLABS_API_BASE_URL_ENV]?.trim()
  const base = configured && configured.length ? configured : ELEVENLABS_API_BASE_URL
  return base.endsWith('/') ? base.slice(0, -1) : base
}

/**
 * The two start endpoints. Which one is used is decided by the tenant's
 * `telephonyProvider` credential (or a per-call override) — never guessed from
 * the shape of the phone-number id, which is an opaque provider-side identifier
 * with no documented, stable encoding of its carrier.
 */
export const OUTBOUND_CALL_PATHS = {
  twilio: '/v1/convai/twilio/outbound-call',
  sip_trunk: '/v1/convai/sip-trunk/outbound-call',
} as const

export type ElevenLabsFetch = (url: string, init: RequestInit) => Promise<Response>

export type ElevenLabsDynamicVariables = Record<string, string | number | boolean | null>

export type ElevenLabsConversationConfigOverride = {
  agent?: {
    first_message?: string
    language?: string
  }
}

export type OutboundCallRequestBody = {
  agent_id: string
  agent_phone_number_id: string
  to_number: string
  conversation_initiation_client_data?: {
    dynamic_variables?: ElevenLabsDynamicVariables
    conversation_config_override?: ElevenLabsConversationConfigOverride
  }
  call_recording_enabled?: boolean
  telephony_call_config?: {
    caller_id?: string
  }
}

/** The documented 200 body of both outbound-call endpoints. */
const outboundCallResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  conversation_id: z.string().nullish(),
  callSid: z.string().nullish(),
})

export type OutboundCallResponse = z.infer<typeof outboundCallResponseSchema>

export class ElevenLabsApiError extends Error {
  readonly code = 'ELEVENLABS_API_ERROR'
  readonly status: number | null
  constructor(message: string, status: number | null) {
    super(`[internal] ${message}`)
    this.name = 'ElevenLabsApiError'
    this.status = status
  }
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'xi-api-key': apiKey, accept: 'application/json' }
}

/**
 * Place the call. Returns the parsed body; it does NOT wait for the call to end
 * — that is the whole point of the suspend/resume seam, and a connector that
 * polled here would pin a worker slot for the length of a phone call.
 */
export async function startOutboundCall(args: {
  apiKey: string
  path: string
  body: OutboundCallRequestBody
  fetchImpl: ElevenLabsFetch
  baseUrl?: string
}): Promise<OutboundCallResponse> {
  const url = `${args.baseUrl ?? resolveElevenLabsBaseUrl()}${args.path}`
  const response = await args.fetchImpl(url, {
    method: 'POST',
    headers: { ...authHeaders(args.apiKey), 'content-type': 'application/json' },
    body: JSON.stringify(args.body),
  })

  if (!response.ok) {
    // The response body is NOT interpolated into the message: a provider error
    // body can echo request fields back, and this message is persisted on the
    // agent run and rendered in the cockpit.
    throw new ElevenLabsApiError(
      `ElevenLabs rejected the outbound call request with HTTP ${response.status}`,
      response.status,
    )
  }

  const parsed = outboundCallResponseSchema.safeParse(await readJson(response))
  if (!parsed.success) {
    throw new ElevenLabsApiError(
      'ElevenLabs returned an outbound-call response that does not match the documented shape',
      response.status,
    )
  }
  return parsed.data
}

/**
 * Probe used by the health check.
 *
 * It asks for one conversation by id. The question the health check is actually
 * answering is "does this API key authenticate?", and the status code answers it
 * unambiguously: 401/403 means the credential was rejected, ANY other response
 * — including the 404 or 422 a sentinel id earns — means ElevenLabs accepted the
 * credential and answered. Staying on the conversations endpoint keeps the probe
 * inside the API surface this package already depends on, so a health check can
 * never pass while the endpoints the connector needs are unreachable.
 */
export async function probeConversationsEndpoint(args: {
  apiKey: string
  conversationId: string
  fetchImpl: ElevenLabsFetch
  baseUrl?: string
}): Promise<{ status: number }> {
  const url = `${args.baseUrl ?? resolveElevenLabsBaseUrl()}/v1/convai/conversations/${encodeURIComponent(args.conversationId)}`
  const response = await args.fetchImpl(url, { method: 'GET', headers: authHeaders(args.apiKey) })
  return { status: response.status }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
