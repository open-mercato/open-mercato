import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import {
  handleDiscordInteraction,
  resolveDiscordInteraction,
  screenInteractionRequest,
  type InteractionCandidate,
} from '../interactions-handler'
import { DiscordInteractionResponseType, DiscordInteractionType } from '../interactions-verify'

function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const publicKeyHex = spki.subarray(spki.length - 32).toString('hex')
  return {
    publicKeyHex,
    sign: (message: string) => cryptoSign(null, Buffer.from(message, 'utf-8'), privateKey).toString('hex'),
  }
}

const timestamp = '1700000000'
const freshness = { nowEpochSeconds: Number(timestamp) }

describe('handleDiscordInteraction', () => {
  it('answers PING with a synchronous PONG for a verified request', () => {
    const signer = makeSigner()
    const rawBody = JSON.stringify({ type: DiscordInteractionType.PING })
    const candidate: InteractionCandidate = {
      channelId: 'ch-1',
      tenantId: 't-1',
      organizationId: 'o-1',
      publicKey: signer.publicKeyHex,
      applicationId: 'app-1',
    }
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
      freshness,
      candidates: [candidate],
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ type: DiscordInteractionResponseType.PONG })
    expect(result.matchedChannel?.channelId).toBe('ch-1')
  })

  it('rejects a tampered signature with 401 and no matched channel (fail-closed)', () => {
    const signer = makeSigner()
    const rawBody = JSON.stringify({ type: DiscordInteractionType.PING })
    const candidate: InteractionCandidate = {
      channelId: 'ch-1',
      tenantId: 't-1',
      organizationId: null,
      publicKey: signer.publicKeyHex,
      applicationId: 'app-1',
    }
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + '{"type":999}'),
      timestamp,
      freshness,
      candidates: [candidate],
    })
    expect(result.status).toBe(401)
    expect(result.matchedChannel).toBeNull()
  })

  it('pins to the channel whose public key verifies (tenant isolation)', () => {
    const tenantA = makeSigner()
    const tenantB = makeSigner()
    const rawBody = JSON.stringify({ type: DiscordInteractionType.APPLICATION_COMMAND })
    // Signed with tenant B's key only.
    const signatureHex = tenantB.sign(timestamp + rawBody)
    const candidates: InteractionCandidate[] = [
      {
        channelId: 'ch-a',
        tenantId: 't-a',
        organizationId: null,
        publicKey: tenantA.publicKeyHex,
        applicationId: 'app-a',
      },
      {
        channelId: 'ch-b',
        tenantId: 't-b',
        organizationId: null,
        publicKey: tenantB.publicKeyHex,
        applicationId: 'app-b',
      },
    ]
    const result = handleDiscordInteraction({ rawBody, signatureHex, timestamp, candidates, freshness })
    expect(result.status).toBe(200)
    expect(result.matchedChannel?.channelId).toBe('ch-b')
    expect(result.matchedChannel?.tenantId).toBe('t-b')
    expect(result.body).toEqual({ type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE })
  })

  it('rejects a replayed capture (valid signature, stale timestamp) BEFORE any verify work', () => {
    const signer = makeSigner()
    const rawBody = JSON.stringify({ type: DiscordInteractionType.PING })
    const candidate: InteractionCandidate = {
      channelId: 'ch-1',
      tenantId: 't-1',
      organizationId: null,
      publicKey: signer.publicKeyHex,
      applicationId: 'app-1',
    }
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
      candidates: [candidate],
      freshness: { nowEpochSeconds: Number(timestamp) + 3600 },
    })
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'stale_timestamp' })
    expect(result.matchedChannel).toBeNull()
  })

  it('rejects when no candidate verifies', () => {
    const signer = makeSigner()
    const other = makeSigner()
    const rawBody = JSON.stringify({ type: DiscordInteractionType.PING })
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
      freshness,
      candidates: [
        {
          channelId: 'ch',
          tenantId: 't',
          organizationId: null,
          publicKey: other.publicKeyHex,
          applicationId: 'app',
        },
      ],
    })
    expect(result.status).toBe(401)
  })
})

describe('screenInteractionRequest', () => {
  it('rejects a request carrying no signature headers at all', () => {
    expect(screenInteractionRequest({ signatureHex: null, timestamp: null, freshness })).toEqual({
      status: 401,
      body: { error: 'stale_timestamp' },
      matchedChannel: null,
    })
  })

  it('rejects a signature that is not 64 hex-encoded bytes', () => {
    expect(screenInteractionRequest({ signatureHex: 'not-hex', timestamp, freshness })).toEqual({
      status: 401,
      body: { error: 'invalid_signature' },
      matchedChannel: null,
    })
    expect(screenInteractionRequest({ signatureHex: 'ab'.repeat(10), timestamp, freshness })?.status).toBe(401)
  })

  it('passes a well-formed, fresh request through to the candidate stage', () => {
    expect(screenInteractionRequest({ signatureHex: 'ab'.repeat(64), timestamp, freshness })).toBeNull()
  })
})

/**
 * Resolving candidates reads every active Discord channel in the installation
 * and decrypts its credentials, so WHEN that happens is an availability property
 * of an endpoint any caller can POST to, not an implementation detail. These
 * tests assert on the loader's CALL COUNT rather than on the response alone, so
 * a refactor that quietly moves the load back above the guards fails here
 * instead of in production.
 */
describe('resolveDiscordInteraction candidate-loading discipline', () => {
  const rawBody = JSON.stringify({ type: DiscordInteractionType.PING, application_id: 'app-1' })

  it('loads no candidates for an unsigned request', async () => {
    const loadCandidates = jest.fn(async () => [] as InteractionCandidate[])
    const result = await resolveDiscordInteraction({
      rawBody: '',
      signatureHex: null,
      timestamp: null,
      loadCandidates,
      freshness,
    })
    expect(result.status).toBe(401)
    expect(loadCandidates).toHaveBeenCalledTimes(0)
  })

  it('loads no candidates for a malformed signature header', async () => {
    const loadCandidates = jest.fn(async () => [] as InteractionCandidate[])
    const result = await resolveDiscordInteraction({
      rawBody,
      signatureHex: 'zzzz',
      timestamp,
      loadCandidates,
      freshness,
    })
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'invalid_signature' })
    expect(loadCandidates).toHaveBeenCalledTimes(0)
  })

  it('loads no candidates for a replayed request, even with a cryptographically valid signature', async () => {
    const signer = makeSigner()
    const loadCandidates = jest.fn(async () => [] as InteractionCandidate[])
    const result = await resolveDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
      loadCandidates,
      freshness: { nowEpochSeconds: Number(timestamp) + 3600 },
    })
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'stale_timestamp' })
    expect(loadCandidates).toHaveBeenCalledTimes(0)
  })

  it('narrows the candidate load by the application id the body claims', async () => {
    const signer = makeSigner()
    const loadCandidates = jest.fn(async () => [
      {
        channelId: 'ch-1',
        tenantId: 't-1',
        organizationId: null,
        publicKey: signer.publicKeyHex,
        applicationId: 'app-1',
      },
    ])
    const result = await resolveDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
      loadCandidates,
      freshness,
    })
    expect(result.status).toBe(200)
    expect(loadCandidates).toHaveBeenCalledTimes(1)
    expect(loadCandidates).toHaveBeenCalledWith({ applicationId: 'app-1' })
  })

  it('falls back to the full candidate set when the body claims no application id', async () => {
    const signer = makeSigner()
    const bodyWithoutApplication = JSON.stringify({ type: DiscordInteractionType.PING })
    const loadCandidates = jest.fn(async () => [
      {
        channelId: 'ch-1',
        tenantId: 't-1',
        organizationId: null,
        publicKey: signer.publicKeyHex,
        applicationId: 'app-1',
      },
    ])
    const result = await resolveDiscordInteraction({
      rawBody: bodyWithoutApplication,
      signatureHex: signer.sign(timestamp + bodyWithoutApplication),
      timestamp,
      loadCandidates,
      freshness,
    })
    expect(result.status).toBe(200)
    expect(loadCandidates).toHaveBeenCalledWith({ applicationId: null })
  })

  it('still rejects a forged application id — narrowing is never authorization', async () => {
    const victim = makeSigner()
    const attacker = makeSigner()
    const forgedBody = JSON.stringify({
      type: DiscordInteractionType.APPLICATION_COMMAND,
      application_id: 'app-victim',
    })
    // Claiming the victim's application makes the narrowing hand the attacker
    // exactly the victim's channel — and the signature gate rejects them anyway.
    const loadCandidates = jest.fn(async (filter: { applicationId: string | null }) => {
      expect(filter.applicationId).toBe('app-victim')
      return [
        {
          channelId: 'ch-victim',
          tenantId: 't-victim',
          organizationId: null,
          publicKey: victim.publicKeyHex,
          applicationId: 'app-victim',
        },
      ]
    })
    const result = await resolveDiscordInteraction({
      rawBody: forgedBody,
      signatureHex: attacker.sign(timestamp + forgedBody),
      timestamp,
      loadCandidates,
      freshness,
    })
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'invalid_signature' })
    expect(result.matchedChannel).toBeNull()
  })
})
