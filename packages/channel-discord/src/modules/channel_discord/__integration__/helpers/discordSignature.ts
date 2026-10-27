import { createPrivateKey, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'

/**
 * Ed25519 request-signing helpers for the Discord Interactions integration
 * tests. Discord signs `timestamp + rawBody` with the application's Ed25519 key
 * and sends the signature in `X-Signature-Ed25519`; the provider route verifies
 * it against every candidate channel's stored public key and is fail-closed.
 *
 * The tests generate their own keypair so they never need a real Discord
 * application, and so a signature that is cryptographically perfect but belongs
 * to no connected channel is still rejected — which is the property under test.
 */

export type DiscordSigner = {
  /** Raw 32-byte Ed25519 public key, hex encoded — the shape Discord shows in the portal. */
  publicKeyHex: string
  /** Sign `timestamp + body` exactly the way Discord does. */
  sign: (timestamp: string, body: string) => string
}

export function createDiscordSigner(): DiscordSigner {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  // SPKI for Ed25519 is a fixed 12-byte header followed by the raw 32-byte key.
  const rawPublicKey = spki.subarray(spki.length - 32)
  const key = createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' }) as string)
  return {
    publicKeyHex: rawPublicKey.toString('hex'),
    sign: (timestamp: string, body: string) =>
      signEd25519(null, Buffer.from(`${timestamp}${body}`, 'utf8'), key).toString('hex'),
  }
}

/** A PING interaction body — the handshake Discord sends when an endpoint URL is saved. */
export function pingInteractionBody(): string {
  return JSON.stringify({ type: 1, id: 'integration-ping', application_id: 'integration' })
}

/**
 * A fully-formed `APPLICATION_COMMAND` body — everything the dispatch path needs
 * (id, follow-up token, application, channel and invoking user), so a rejection
 * can only come from the signature gate and never from an incomplete payload.
 */
export function slashCommandInteractionBody(): string {
  return JSON.stringify({
    type: 2,
    id: 'integration-command',
    token: 'integration-follow-up-token',
    application_id: 'integration',
    channel_id: 'integration-channel',
    member: { user: { id: 'integration-user', username: 'integration' } },
    data: { name: 'mercato', options: [{ name: 'message', value: 'integration probe' }] },
  })
}

/** Current unix seconds as the signed timestamp header value. */
export function freshTimestamp(): string {
  return String(Math.floor(Date.now() / 1000))
}

/** A timestamp far outside the provider's replay window (DISCORD_SIGNATURE_MAX_SKEW_SECONDS = 300). */
export function staleTimestamp(): string {
  return String(Math.floor(Date.now() / 1000) - 3600)
}

export const INTERACTIONS_PATH = '/api/channel_discord/interactions'

/**
 * The interactions endpoint is posted with a RAW body (the signature covers the
 * exact bytes), so these specs bypass `apiRequest` and call Playwright's request
 * context directly — which means they must resolve `BASE_URL` the same way the
 * shared helper does.
 */
export function interactionsUrl(): string {
  const base = process.env.BASE_URL?.trim()
  return base ? `${base}${INTERACTIONS_PATH}` : INTERACTIONS_PATH
}
