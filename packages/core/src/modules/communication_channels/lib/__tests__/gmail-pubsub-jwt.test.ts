import crypto from 'node:crypto'
import {
  decodeGmailPubSubBody,
  getGmailPubSubVerifier,
  setGmailPubSubVerifier,
  GmailPubSubJwtError,
} from '../gmail-pubsub-jwt'

describe('decodeGmailPubSubBody', () => {
  it('decodes a valid Pub/Sub envelope', () => {
    const inner = { emailAddress: 'alice@example.com', historyId: '12345' }
    const data = Buffer.from(JSON.stringify(inner), 'utf-8').toString('base64')
    const envelope = JSON.stringify({
      message: { data, messageId: 'm1', publishTime: '2026-05-27T00:00:00Z' },
      subscription: 'projects/p/subscriptions/s',
    })
    const result = decodeGmailPubSubBody(envelope)
    expect(result.emailAddress).toBe('alice@example.com')
    expect(String(result.historyId)).toBe('12345')
  })

  it('rejects non-JSON bodies', () => {
    expect(() => decodeGmailPubSubBody('not-json')).toThrow(GmailPubSubJwtError)
  })

  it('rejects envelopes missing message.data', () => {
    const envelope = JSON.stringify({ message: { messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(/message\.data/)
  })

  it('rejects payloads missing emailAddress', () => {
    const data = Buffer.from(JSON.stringify({ historyId: '1' }), 'utf-8').toString('base64')
    const envelope = JSON.stringify({ message: { data, messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(/emailAddress/)
  })

  it('rejects payloads missing historyId', () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: 'a@b.c' }), 'utf-8').toString('base64')
    const envelope = JSON.stringify({ message: { data, messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(/historyId/)
  })

  it('rejects non-base64 message.data', () => {
    // Stringified array that JSON.parse-decodes but throws downstream when parsed as JSON
    const envelope = JSON.stringify({ message: { data: '!!!not-base64!!!', messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(GmailPubSubJwtError)
  })
})

describe('FetchGmailPubSubVerifier.verify (signature + claims)', () => {
  const KID = 'test-kid-1'
  const AUDIENCE = 'https://app.example/api/communication_channels/webhooks/gmail'
  const SERVICE_ACCOUNT = 'gmail-api-push@system.gserviceaccount.com'
  const ISSUER = 'https://accounts.google.com'

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const b64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64url')

  function signJwt(claims: Record<string, unknown>, kid = KID): string {
    const signingInput = `${b64url({ alg: 'RS256', kid })}.${b64url(claims)}`
    const signature = crypto.createSign('RSA-SHA256').update(signingInput).end().sign(privateKey)
    return `${signingInput}.${signature.toString('base64url')}`
  }

  function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000)
    return {
      iss: ISSUER,
      aud: AUDIENCE,
      email: SERVICE_ACCOUNT,
      email_verified: true,
      iat: now - 10,
      exp: now + 600,
      ...overrides,
    }
  }

  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Fresh verifier per test (clears the cert cache) + mock the Google certs endpoint.
    setGmailPubSubVerifier(null)
    ;(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ [KID]: publicKey }),
    }))
  })

  afterEach(() => {
    setGmailPubSubVerifier(null)
    ;(globalThis as unknown as { fetch: unknown }).fetch = originalFetch
  })

  const verify = (token: string) =>
    getGmailPubSubVerifier().verify({
      authorizationHeader: `Bearer ${token}`,
      expectedAudience: AUDIENCE,
      expectedEmail: SERVICE_ACCOUNT,
    })

  it('accepts a correctly signed token with valid claims', async () => {
    const claims = await verify(signJwt(validClaims()))
    expect(claims.email).toBe(SERVICE_ACCOUNT)
    expect(claims.aud).toBe(AUDIENCE)
  })

  it('rejects a tampered signature', async () => {
    const token = signJwt(validClaims())
    const tampered = `${token.slice(0, -4)}AAAA`
    await expect(verify(tampered)).rejects.toMatchObject({ code: 'invalid_signature' })
  })

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000)
    await expect(verify(signJwt(validClaims({ exp: now - 60 })))).rejects.toMatchObject({ code: 'expired' })
  })

  it('rejects a wrong audience', async () => {
    await expect(verify(signJwt(validClaims({ aud: 'https://evil.example' })))).rejects.toMatchObject({
      code: 'wrong_audience',
    })
  })

  it('rejects a wrong issuer', async () => {
    await expect(verify(signJwt(validClaims({ iss: 'https://evil.example' })))).rejects.toMatchObject({
      code: 'wrong_issuer',
    })
  })

  it('rejects a non-matching / unverified service-account email', async () => {
    await expect(verify(signJwt(validClaims({ email: 'attacker@evil.example' })))).rejects.toMatchObject({
      code: 'wrong_email',
    })
    await expect(verify(signJwt(validClaims({ email_verified: false })))).rejects.toMatchObject({
      code: 'wrong_email',
    })
  })
})
