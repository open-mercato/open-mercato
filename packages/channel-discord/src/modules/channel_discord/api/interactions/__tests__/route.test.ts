import { generateKeyPairSync, sign } from 'node:crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DEFAULT_WEBHOOK_BODY_LIMIT_BYTES } from '@open-mercato/shared/lib/webhooks'
import { resolveDiscordInteraction } from '../../../lib/interactions-handler'
import { getInteractionDispatchQueue } from '../../../lib/interactions-queue'
import { POST } from '../route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn() }))
jest.mock('@open-mercato/core/modules/communication_channels/data/entities', () => ({
  CommunicationChannel: class CommunicationChannel {},
}))
jest.mock('../../../lib/interactions-queue', () => ({ getInteractionDispatchQueue: jest.fn() }))
jest.mock('../../../lib/interactions-handler', () => {
  const actual = jest.requireActual<typeof import('../../../lib/interactions-handler')>('../../../lib/interactions-handler')
  return { ...actual, resolveDiscordInteraction: jest.fn(actual.resolveDiscordInteraction) }
})

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
const publicKeyHex = publicKeyDer.subarray(publicKeyDer.length - 32).toString('hex')
const credentialsResolve = jest.fn()
const entityManager = { fork: jest.fn() }
const containerResolve = jest.fn()
const encoder = new TextEncoder()

function signedHeaders(rawBody: string): Headers {
  const timestamp = String(Math.floor(Date.now() / 1000))
  return new Headers({
    'x-signature-timestamp': timestamp,
    'x-signature-ed25519': sign(null, Buffer.from(timestamp + rawBody), privateKey).toString('hex'),
  })
}

function streamingRequest(chunks: Uint8Array[], headers: Headers) {
  let nextChunk = 0
  const cancel = jest.fn()
  const pull = jest.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[nextChunk++]
    if (chunk) controller.enqueue(chunk)
    else controller.close()
  })
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
  const request = new Request('http://localhost/api/channel_discord/interactions', {
    method: 'POST', headers, body, duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  return { request, pull, cancel }
}

function expectNoDownstreamWork() {
  expect(resolveDiscordInteraction).not.toHaveBeenCalled()
  expect(resolveTranslations).not.toHaveBeenCalled()
  expect(createRequestContainer).not.toHaveBeenCalled()
  expect(findWithDecryption).not.toHaveBeenCalled()
  expect(credentialsResolve).not.toHaveBeenCalled()
  expect(getInteractionDispatchQueue).not.toHaveBeenCalled()
}

describe('Discord interaction request body limits', () => {
  const previousLimit = process.env.OM_WEBHOOK_MAX_BODY_BYTES

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_WEBHOOK_MAX_BODY_BYTES
    entityManager.fork.mockReturnValue(entityManager)
    containerResolve.mockImplementation((name: string) => {
      if (name === 'em') return entityManager
      if (name === 'integrationCredentialsService') return { resolve: credentialsResolve }
      throw new Error(`[internal] Unexpected service ${name}`)
    })
    jest.mocked(createRequestContainer).mockResolvedValue({ resolve: containerResolve } as never)
    jest.mocked(resolveTranslations).mockResolvedValue({
      t: (key: string, fallback?: string) => fallback ?? key,
    } as never)
    jest.mocked(findWithDecryption).mockResolvedValue([{
      id: 'channel-1', channelType: 'discord', tenantId: 'tenant-1', organizationId: null,
      credentialsRef: 'discord', userId: null,
    }] as never)
    credentialsResolve.mockResolvedValue({ botToken: 'test-bot-token', applicationId: 'app-1', publicKey: publicKeyHex })
  })

  afterAll(() => {
    if (previousLimit === undefined) delete process.env.OM_WEBHOOK_MAX_BODY_BYTES
    else process.env.OM_WEBHOOK_MAX_BODY_BYTES = previousLimit
  })

  it.each(['missing', 'malformed', 'stale'])('rejects %s signature headers before consuming the body', async (kind) => {
    const headers = signedHeaders('{}')
    if (kind === 'missing') headers.delete('x-signature-ed25519')
    if (kind === 'malformed') headers.set('x-signature-ed25519', 'not-a-signature')
    if (kind === 'stale') headers.set('x-signature-timestamp', '1')
    const { request, pull } = streamingRequest([encoder.encode('{}')], headers)

    expect((await POST(request)).status).toBe(401)
    expect(pull).not.toHaveBeenCalled()
    expect(request.bodyUsed).toBe(false)
    expectNoDownstreamWork()
  })

  it('rejects an oversized declared length before reading any body bytes', async () => {
    const headers = signedHeaders('{}')
    headers.set('content-length', String(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES + 1))
    const { request, pull } = streamingRequest([encoder.encode('{}')], headers)

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload_too_large' })
    expect(pull).not.toHaveBeenCalled()
    expectNoDownstreamWork()
  })

  it.each([undefined, '2', 'invalid'])('bounds chunked input with Content-Length %s and cancels on overflow', async (declaredLength) => {
    process.env.OM_WEBHOOK_MAX_BODY_BYTES = '64'
    const headers = signedHeaders('{}')
    if (declaredLength !== undefined) headers.set('content-length', declaredLength)
    const { request, cancel, pull } = streamingRequest([
      new Uint8Array(32), new Uint8Array(33), encoder.encode('never read'),
    ], headers)

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(pull).toHaveBeenCalledTimes(2)
    expectNoDownstreamWork()
  })

  it.each([256, DEFAULT_WEBHOOK_BODY_LIMIT_BYTES])('accepts a signed PING at the exact %i-byte boundary', async (limit) => {
    if (limit !== DEFAULT_WEBHOOK_BODY_LIMIT_BYTES) process.env.OM_WEBHOOK_MAX_BODY_BYTES = String(limit)
    const payload = JSON.stringify({ type: 1, application_id: 'app-1', note: '€' })
    const rawBody = payload + ' '.repeat(limit - Buffer.byteLength(payload))
    const bytes = encoder.encode(rawBody)
    const split = bytes.indexOf(0xe2) + 1
    const headers = signedHeaders(rawBody)
    headers.set('content-length', String(limit))
    const { request } = streamingRequest([bytes.subarray(0, split), bytes.subarray(split)], headers)

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: 1 })
    expect(resolveDiscordInteraction).toHaveBeenCalledWith(expect.objectContaining({ rawBody }))
    expect(credentialsResolve).toHaveBeenCalledTimes(1)
    expect(getInteractionDispatchQueue).not.toHaveBeenCalled()
  })

  it('preserves the signed PING handshake below the limit without Content-Length', async () => {
    const rawBody = JSON.stringify({ type: 1, application_id: 'app-1' })
    const { request } = streamingRequest([encoder.encode(rawBody)], signedHeaders(rawBody))

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: 1 })
    expect(createRequestContainer).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['PING', 1, 'different-tenant'],
    ['command', 2, 'different-tenant'],
    ['component', 3, 'different-user'],
    ['modal', 5, 'different-user'],
  ])('rejects an ambiguous signed %s before any queue work (%s, %s)', async (_name, type, scope) => {
    const first = {
      id: 'channel-1', channelType: 'discord', tenantId: 'tenant-1', organizationId: 'org-1',
      credentialsRef: 'discord', userId: 'user-1',
    }
    const second = {
      ...first, id: 'channel-2', tenantId: scope === 'different-tenant' ? 'tenant-2' : 'tenant-1', userId: 'user-2',
    }
    const rawBody = JSON.stringify({
      type, id: 'interaction-1', application_id: 'app-1', token: 'test-interaction-token',
      channel_id: 'discord-channel-1', user: { id: 'discord-user-1' },
      data: { name: 'mercato', custom_id: 'test-component', components: [] },
    })
    for (const rows of [[first, second], [second, first]]) {
      jest.mocked(findWithDecryption).mockResolvedValue(rows as never)
      const response = await POST(new Request('http://localhost/api/channel_discord/interactions', {
        method: 'POST', headers: signedHeaders(rawBody), body: rawBody,
      }))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'ambiguous_signature' })
      expect(getInteractionDispatchQueue).not.toHaveBeenCalled()
    }
    expect(credentialsResolve).toHaveBeenCalledWith('channel_discord', {
      tenantId: first.tenantId, organizationId: first.organizationId, userId: first.userId,
    })
    expect(credentialsResolve).toHaveBeenCalledWith('channel_discord', {
      tenantId: second.tenantId, organizationId: second.organizationId, userId: second.userId,
    })
  })

  it.each([2, 3, 5])('dispatches an authorized type %i interaction only under its matching channel scope', async (type) => {
    const enqueue = jest.fn().mockResolvedValue(undefined)
    jest.mocked(getInteractionDispatchQueue).mockReturnValue({ enqueue } as never)
    jest.mocked(findWithDecryption).mockResolvedValue([
      { id: 'unrelated-channel', channelType: 'discord', tenantId: 'other-tenant', organizationId: null, credentialsRef: 'discord', userId: null },
      { id: 'channel-1', channelType: 'discord', tenantId: 'tenant-1', organizationId: 'org-1', credentialsRef: 'discord', userId: 'user-1' },
    ] as never)
    credentialsResolve.mockImplementation(async (_integration: string, scope: { tenantId: string }) => ({
      botToken: 'test-bot-token', applicationId: 'app-1',
      publicKey: scope.tenantId === 'tenant-1' ? publicKeyHex : 'b'.repeat(64),
    }))
    const rawBody = JSON.stringify({
      type, id: 'interaction-1', application_id: 'app-1', token: 'test-interaction-token',
      channel_id: 'discord-channel-1', user: { id: 'discord-user-1' },
      data: { name: 'mercato', custom_id: 'test-component', components: [] },
    })
    const response = await POST(new Request('http://localhost/api/channel_discord/interactions', {
      method: 'POST', headers: signedHeaders(rawBody), body: rawBody,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: 5 })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'channel-1', tenantId: 'tenant-1', organizationId: 'org-1',
      credentialScope: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
      interaction: expect.objectContaining({ id: 'interaction-1', type }),
    }))
  })

  it('propagates a stream failure without calling the interaction handler', async () => {
    const failure = new Error('[internal] request stream failed')
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure) } })
    const request = new Request('http://localhost/api/channel_discord/interactions', {
      method: 'POST', headers: signedHeaders('{}'), body, duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await expect(POST(request)).rejects.toBe(failure)
    expectNoDownstreamWork()
  })
})
