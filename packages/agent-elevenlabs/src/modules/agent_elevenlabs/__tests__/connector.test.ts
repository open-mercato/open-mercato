import { createHmac } from 'node:crypto'
import { z } from 'zod'
import type { AgentRegistryEntry } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import type { ExternalAgentConnectorStartArgs } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import {
  CALLBACK_URL_VARIABLE,
  createElevenLabsVoiceConnector,
  ELEVENLABS_VOICE_CONNECTOR_ID,
} from '../lib/connector'
import type { ElevenLabsCallProfile, ElevenLabsCredentials } from '../lib/credentials'
import type { ElevenLabsFetch, OutboundCallRequestBody } from '../lib/api'
import { voiceCallResultSchema } from '../data/validators'

const API_KEY = 'sk_super_secret_elevenlabs_key'
const WEBHOOK_SECRET = 'wsec_super_secret_webhook_value'
const BASE_URL = 'https://api.elevenlabs.test'
const NOW_MS = 1_800_000_000_000
const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

/**
 * A tenant with a single `default` profile — the shape every tenant configured
 * before named profiles existed resolves to. Overrides target that profile, so
 * these cases read exactly as they did before profiles landed.
 */
function credentials(overrides: Partial<Omit<ElevenLabsCallProfile, 'name'>> = {}): ElevenLabsCredentials {
  return {
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
    profiles: {
      default: {
        name: 'default',
        agentId: 'agent_abc123',
        phoneNumberId: 'phnum_zzz999',
        telephonyProvider: 'twilio',
        defaultCallerId: null,
        callRecordingEnabled: null,
        ...overrides,
      },
    },
  }
}

const AGENT_ENTRY: AgentRegistryEntry = {
  id: 'voice.owner_call',
  moduleId: 'agent_elevenlabs',
  resultKind: 'researcher',
  schema: z.object({ kind: z.literal('researcher'), data: z.object({}) }),
  tools: [],
  skills: [],
  subAgents: [],
  label: 'Call a person',
  description: 'demo',
  instructions: '',
  runtime: 'external',
  connectorId: ELEVENLABS_VOICE_CONNECTOR_ID,
}

type CapturedRequest = { url: string; init: RequestInit }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeFetch(
  responder: (request: CapturedRequest) => Response,
): { fetchImpl: ElevenLabsFetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetchImpl: ElevenLabsFetch = async (url, init) => {
    const request = { url, init }
    calls.push(request)
    return responder(request)
  }
  return { fetchImpl, calls }
}

function startArgs(input: unknown, callbackUrl = 'https://app.example/api/agent_orchestrator/external-runs/xrun_tok/callback'): ExternalAgentConnectorStartArgs {
  return {
    agentEntry: AGENT_ENTRY,
    input,
    callbackUrl,
    callbackToken: 'xrun_tok',
    scope: SCOPE,
  }
}

function bodyOf(call: CapturedRequest): OutboundCallRequestBody {
  return JSON.parse(String(call.init.body)) as OutboundCallRequestBody
}

describe('ElevenLabs voice connector — start()', () => {
  it('posts the documented outbound-call body and returns the conversation id', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, message: 'ok', conversation_id: 'conv_9f2c', callSid: 'CA1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    const result = await connector.start(
      startArgs({
        toNumber: '+48123456789',
        brief: 'The ACME renewal has gone quiet.',
        variables: { company_name: 'ACME', deal_value: 48000 },
      }),
    )

    expect(result).toEqual({ externalRunId: 'conv_9f2c', expectsCallback: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE_URL}/v1/convai/twilio/outbound-call`)
    expect(calls[0].init.method).toBe('POST')

    const body = bodyOf(calls[0])
    expect(body.agent_id).toBe('agent_abc123')
    expect(body.agent_phone_number_id).toBe('phnum_zzz999')
    expect(body.to_number).toBe('+48123456789')
    expect(body.conversation_initiation_client_data?.dynamic_variables).toEqual({
      company_name: 'ACME',
      deal_value: 48000,
      brief: 'The ACME renewal has gone quiet.',
      [CALLBACK_URL_VARIABLE]: 'https://app.example/api/agent_orchestrator/external-runs/xrun_tok/callback',
    })
  })

  it('authenticates with the xi-api-key header', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(startArgs({ toNumber: '+48123456789' }))

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['xi-api-key']).toBe(API_KEY)
    expect(headers['content-type']).toBe('application/json')
  })

  it('serialises a structured variable rather than dropping it', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(
      startArgs({ toNumber: '+48123456789', variables: { alert: { severity: 'critical' } } }),
    )

    expect(bodyOf(calls[0]).conversation_initiation_client_data?.dynamic_variables?.alert).toBe(
      '{"severity":"critical"}',
    )
  })

  it('never lets an author variable take over the reserved om_ namespace', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(
      startArgs(
        { toNumber: '+48123456789', variables: { [CALLBACK_URL_VARIABLE]: 'https://attacker.example/' } },
        'https://app.example/callback/real',
      ),
    )

    expect(
      bodyOf(calls[0]).conversation_initiation_client_data?.dynamic_variables?.[CALLBACK_URL_VARIABLE],
    ).toBe('https://app.example/callback/real')
  })

  it('passes the tenant caller id and recording default through', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () =>
        credentials({ defaultCallerId: '+48999888777', callRecordingEnabled: true }),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(startArgs({ toNumber: '+48123456789' }))

    const body = bodyOf(calls[0])
    expect(body.telephony_call_config).toEqual({ caller_id: '+48999888777' })
    expect(body.call_recording_enabled).toBe(true)
  })

  it('omits call_recording_enabled when the tenant expressed no preference', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(startArgs({ toNumber: '+48123456789' }))

    expect('call_recording_enabled' in bodyOf(calls[0])).toBe(false)
  })

  it('sends first_message and language as a conversation_config_override', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(
      startArgs({ toNumber: '+48123456789', firstMessage: 'Hi Anna.', language: 'pl' }),
    )

    expect(
      bodyOf(calls[0]).conversation_initiation_client_data?.conversation_config_override,
    ).toEqual({ agent: { first_message: 'Hi Anna.', language: 'pl' } })
  })
})

describe('ElevenLabs voice connector — Twilio vs SIP selection', () => {
  it('uses the SIP trunk endpoint when the tenant credential says so', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials({ telephonyProvider: 'sip_trunk' }),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(startArgs({ toNumber: '+48123456789' }))

    expect(calls[0].url).toBe(`${BASE_URL}/v1/convai/sip-trunk/outbound-call`)
  })

  it('lets the node input override the tenant default per call', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials({ telephonyProvider: 'sip_trunk' }),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await connector.start(startArgs({ toNumber: '+48123456789', telephonyProvider: 'twilio' }))

    expect(calls[0].url).toBe(`${BASE_URL}/v1/convai/twilio/outbound-call`)
  })
})

describe('ElevenLabs voice connector — start() failure arms', () => {
  it('treats a 200 with success:false as a real failure', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ success: false, message: 'agent has no phone number', conversation_id: null }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await expect(connector.start(startArgs({ toNumber: '+48123456789' }))).rejects.toThrow(
      /agent has no phone number/,
    )
  })

  it('treats success:true with a null conversation_id as a real failure', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ success: true, conversation_id: null }))
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await expect(connector.start(startArgs({ toNumber: '+48123456789' }))).rejects.toThrow(
      /no conversation_id/,
    )
  })

  it('fails on a non-2xx response', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ detail: 'unauthorized' }, 401))
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await expect(connector.start(startArgs({ toNumber: '+48123456789' }))).rejects.toThrow(
      /HTTP 401/,
    )
  })

  it('rejects an input that is not a voice-call request before touching the network', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ success: true, conversation_id: 'conv_1' }),
    )
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    await expect(connector.start(startArgs({ subject: 'no phone number here' }))).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['success:false', () => jsonResponse({ success: false, message: `key ${API_KEY} is invalid` })],
    ['HTTP 401', () => jsonResponse({ detail: `key ${API_KEY} rejected` }, 401)],
    ['unparseable body', () => jsonResponse({ unexpected: API_KEY })],
  ])('never leaks a secret in the thrown error (%s)', async (_label, responder) => {
    const { fetchImpl } = makeFetch(responder)
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      baseUrl: BASE_URL,
    })

    // The provider's own error body echoes the key back; nothing we throw may.
    await expect(connector.start(startArgs({ toNumber: '+48123456789' }))).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(API_KEY) as unknown as string,
      }),
    )
  })
})

describe('ElevenLabs voice connector — verifyCallback()', () => {
  const RAW_BODY = '{ "type":"post_call_transcription", "data": {"conversation_id":"conv_9f2c"} }'

  function connectorWithClock() {
    return createElevenLabsVoiceConnector({
      readCredentials: async () => credentials(),
      fetchImpl: async () => jsonResponse({}),
      nowMs: () => NOW_MS,
      baseUrl: BASE_URL,
    })
  }

  function signedHeaders(rawBody: string, secret = WEBHOOK_SECRET, timestampSeconds = Math.floor(NOW_MS / 1000)): Headers {
    const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
    return new Headers({ 'ElevenLabs-Signature': `t=${timestampSeconds},v0=${digest}` })
  }

  it('accepts a callback signed with the tenant webhook secret', async () => {
    await expect(
      connectorWithClock().verifyCallback(signedHeaders(RAW_BODY), RAW_BODY, SCOPE),
    ).resolves.toBe(true)
  })

  it('reads the header case-insensitively', async () => {
    const digest = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${Math.floor(NOW_MS / 1000)}.${RAW_BODY}`)
      .digest('hex')
    const headers = new Headers({ 'elevenlabs-signature': `t=${Math.floor(NOW_MS / 1000)},v0=${digest}` })
    await expect(connectorWithClock().verifyCallback(headers, RAW_BODY, SCOPE)).resolves.toBe(true)
  })

  it('rejects a callback signed with another tenant secret', async () => {
    await expect(
      connectorWithClock().verifyCallback(signedHeaders(RAW_BODY, 'wsec_other'), RAW_BODY, SCOPE),
    ).resolves.toBe(false)
  })

  it('rejects when the body no longer matches the signed bytes', async () => {
    const headers = signedHeaders(RAW_BODY)
    await expect(
      connectorWithClock().verifyCallback(headers, RAW_BODY.replace('conv_9f2c', 'conv_evil'), SCOPE),
    ).resolves.toBe(false)
  })

  it('rejects a callback outside the 1800 s replay window', async () => {
    const stale = Math.floor(NOW_MS / 1000) - 1801
    await expect(
      connectorWithClock().verifyCallback(signedHeaders(RAW_BODY, WEBHOOK_SECRET, stale), RAW_BODY, SCOPE),
    ).resolves.toBe(false)
  })

  it('reads the webhook secret under the scope it was handed', async () => {
    const seen: Array<{ tenantId: string; organizationId: string }> = []
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async (scope) => {
        seen.push(scope)
        return credentials()
      },
      fetchImpl: async () => jsonResponse({}),
      nowMs: () => NOW_MS,
      baseUrl: BASE_URL,
    })

    await connector.verifyCallback(signedHeaders(RAW_BODY), RAW_BODY, SCOPE)

    expect(seen).toEqual([SCOPE])
  })
})

describe('ElevenLabs voice connector — surface', () => {
  const connector = createElevenLabsVoiceConnector({
    readCredentials: async () => credentials(),
    fetchImpl: async () => jsonResponse({}),
  })

  it('claims the documented connector id', () => {
    expect(connector.id).toBe('elevenlabs.voice')
  })

  it('normalizes through to the declared envelope', () => {
    const normalized = connector.normalize({
      type: 'post_call_transcription',
      data: { conversation_id: 'conv_1', status: 'done', transcript: [] },
    })
    expect(voiceCallResultSchema.safeParse(normalized).success).toBe(true)
  })

  it('implements no cancel — the verified ElevenLabs surface has no hang-up endpoint', () => {
    expect(connector.cancel).toBeUndefined()
  })

  it('implements no mock, so dry runs and eval replays REFUSE instead of dialling', () => {
    expect(connector.mock).toBeUndefined()
  })
})
