import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { handleDiscordInteraction, type InteractionCandidate } from '../interactions-handler'
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

describe('handleDiscordInteraction', () => {
  it('answers PING with a synchronous PONG for a verified request', () => {
    const signer = makeSigner()
    const rawBody = JSON.stringify({ type: DiscordInteractionType.PING })
    const candidate: InteractionCandidate = {
      channelId: 'ch-1',
      tenantId: 't-1',
      organizationId: 'o-1',
      publicKey: signer.publicKeyHex,
    }
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
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
    }
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + '{"type":999}'),
      timestamp,
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
      { channelId: 'ch-a', tenantId: 't-a', organizationId: null, publicKey: tenantA.publicKeyHex },
      { channelId: 'ch-b', tenantId: 't-b', organizationId: null, publicKey: tenantB.publicKeyHex },
    ]
    const result = handleDiscordInteraction({ rawBody, signatureHex, timestamp, candidates })
    expect(result.status).toBe(200)
    expect(result.matchedChannel?.channelId).toBe('ch-b')
    expect(result.matchedChannel?.tenantId).toBe('t-b')
    expect(result.body).toEqual({ type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE })
  })

  it('rejects when no candidate verifies', () => {
    const signer = makeSigner()
    const other = makeSigner()
    const rawBody = JSON.stringify({ type: DiscordInteractionType.PING })
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
      candidates: [{ channelId: 'ch', tenantId: 't', organizationId: null, publicKey: other.publicKeyHex }],
    })
    expect(result.status).toBe(401)
  })
})
