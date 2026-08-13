/**
 * Fetch-on-demand recording (tracker task 3.4).
 *
 * The connector's promise is that a recording is BORROWED, not taken: it asks
 * ElevenLabs for the audio and hands back the live stream, so no copy of a
 * caller's voice exists in this deployment. These tests pin that promise at the
 * only place it can be broken — the connector — plus the two "there is nothing
 * to play" arms that must not read as faults.
 */

import { createElevenLabsVoiceConnector, ELEVENLABS_VOICE_CONNECTOR_ID } from '../lib/connector'
import { fetchConversationAudio, ElevenLabsApiError, type ElevenLabsFetch } from '../lib/api'
import type { ElevenLabsCredentials } from '../lib/credentials'

const API_KEY = 'sk_super_secret_elevenlabs_key'
const WEBHOOK_SECRET = 'wsec_super_secret_webhook_value'
const BASE_URL = 'https://api.elevenlabs.test'
const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const CONVERSATION_ID = 'conv_9f2c'

function credentials(): ElevenLabsCredentials {
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
      },
    },
  }
}

type CapturedRequest = { url: string; init: RequestInit }

function makeFetch(responder: (request: CapturedRequest) => Response) {
  const calls: CapturedRequest[] = []
  const fetchImpl: ElevenLabsFetch = async (url, init) => {
    const request = { url, init }
    calls.push(request)
    return responder(request)
  }
  return { fetchImpl, calls }
}

function audioResponse(bytes: string, headers: Record<string, string> = {}): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length), ...headers },
  })
}

function connectorWith(responder: (request: CapturedRequest) => Response) {
  const { fetchImpl, calls } = makeFetch(responder)
  const connector = createElevenLabsVoiceConnector({
    readCredentials: async () => credentials(),
    fetchImpl,
    baseUrl: BASE_URL,
  })
  return { connector, calls }
}

describe('fetchConversationAudio', () => {
  it('calls the documented audio endpoint with the tenant’s api key', async () => {
    const { fetchImpl, calls } = makeFetch(() => audioResponse('ID3-bytes'))

    const response = await fetchConversationAudio({
      apiKey: API_KEY,
      conversationId: CONVERSATION_ID,
      fetchImpl,
      baseUrl: BASE_URL,
    })

    expect(response?.status).toBe(200)
    expect(calls[0].url).toBe(`${BASE_URL}/v1/convai/conversations/${CONVERSATION_ID}/audio`)
    expect(calls[0].init.method).toBe('GET')
    expect((calls[0].init.headers as Record<string, string>)['xi-api-key']).toBe(API_KEY)
  })

  it('encodes the conversation id into the path', async () => {
    const { fetchImpl, calls } = makeFetch(() => audioResponse('x'))
    await fetchConversationAudio({
      apiKey: API_KEY,
      conversationId: 'conv/../secrets',
      fetchImpl,
      baseUrl: BASE_URL,
    })
    expect(calls[0].url).toBe(`${BASE_URL}/v1/convai/conversations/conv%2F..%2Fsecrets/audio`)
  })

  it('treats 404 as "no recording", not as a fault', async () => {
    const { fetchImpl } = makeFetch(() => new Response('', { status: 404 }))
    await expect(
      fetchConversationAudio({ apiKey: API_KEY, conversationId: CONVERSATION_ID, fetchImpl, baseUrl: BASE_URL }),
    ).resolves.toBeNull()
  })

  it('throws for a real provider error without echoing its body', async () => {
    const { fetchImpl } = makeFetch(
      () => new Response(JSON.stringify({ detail: `key ${API_KEY} is revoked` }), { status: 401 }),
    )
    const promise = fetchConversationAudio({
      apiKey: API_KEY,
      conversationId: CONVERSATION_ID,
      fetchImpl,
      baseUrl: BASE_URL,
    })
    await expect(promise).rejects.toBeInstanceOf(ElevenLabsApiError)
    await expect(promise).rejects.toThrow(/HTTP 401/)
    await expect(promise).rejects.not.toThrow(new RegExp(API_KEY))
  })
})

describe('ElevenLabs voice connector — fetchRecording()', () => {
  it('is implemented, which is what opts the connector in to the run-detail control', () => {
    const { connector } = connectorWith(() => audioResponse('x'))
    expect(connector.id).toBe(ELEVENLABS_VOICE_CONNECTOR_ID)
    expect(typeof connector.fetchRecording).toBe('function')
  })

  it('hands back the provider’s live stream, unread, with its declared type and size', async () => {
    const providerResponse = audioResponse('ID3-audio-bytes')
    const { connector } = connectorWith(() => providerResponse)

    const recording = await connector.fetchRecording!(CONVERSATION_ID, SCOPE)

    expect(recording).not.toBeNull()
    expect(recording!.mimeType).toBe('audio/mpeg')
    expect(recording!.contentLength).toBe('ID3-audio-bytes'.length)
    expect(recording!.fileName).toBe(`elevenlabs-conversation-${CONVERSATION_ID}.mp3`)

    // THE PROMISE: the stream returned IS the provider's own body, not a copy
    // this package read and re-wrapped. Nothing here buffered the audio.
    expect(recording!.stream).toBe(providerResponse.body)
    expect(providerResponse.bodyUsed).toBe(false)
    expect(recording!.stream.locked).toBe(false)
  })

  it('reports null — never an error — when the provider has no recording', async () => {
    const { connector } = connectorWith(() => new Response('', { status: 404 }))
    await expect(connector.fetchRecording!(CONVERSATION_ID, SCOPE)).resolves.toBeNull()
  })

  it('reports null for a blank provider run id without calling out at all', async () => {
    const { connector, calls } = connectorWith(() => audioResponse('x'))
    await expect(connector.fetchRecording!('   ', SCOPE)).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('propagates a genuine provider fault so the route can report it as one', async () => {
    const { connector } = connectorWith(() => new Response('', { status: 500 }))
    await expect(connector.fetchRecording!(CONVERSATION_ID, SCOPE)).rejects.toBeInstanceOf(ElevenLabsApiError)
  })

  it('reads this tenant’s credentials per call rather than holding any', async () => {
    const readCredentials = jest.fn(async () => credentials())
    const { fetchImpl } = makeFetch(() => audioResponse('x'))
    const connector = createElevenLabsVoiceConnector({ readCredentials, fetchImpl, baseUrl: BASE_URL })

    await connector.fetchRecording!(CONVERSATION_ID, SCOPE)
    expect(readCredentials).toHaveBeenCalledWith(SCOPE)
  })
})
