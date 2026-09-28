import { isSafeRedirectTarget, signTrackingToken, verifyTrackingToken } from '../token'
import type { TrackingClaims } from '../token'
import { resolveTrackingSecret, trackingSecretEnvNames } from '../secret'

const SECRET = 'a-test-secret'
const claims: TrackingClaims = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  campaignId: '33333333-3333-4333-8333-333333333333',
  runId: '44444444-4444-4444-8444-444444444444',
  stepId: 'step-1',
  purpose: 'open',
}

describe('tracking tokens', () => {
  test('round-trips every claim', () => {
    expect(verifyTrackingToken(signTrackingToken(claims, SECRET), SECRET)).toEqual(claims)
  })

  test('carries a click target', () => {
    const click = { ...claims, purpose: 'click' as const, target: 'https://shop.example.com/offer?a=1&b=2' }
    expect(verifyTrackingToken(signTrackingToken(click, SECRET), SECRET)).toEqual(click)
  })

  test('is url-safe, so it survives an email attribute unescaped', () => {
    const token = signTrackingToken({ ...claims, purpose: 'click', target: 'https://x.test/a b?c=1&d=2' }, SECRET)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(token)).toBe(token)
  })

  // The endpoints are public, so forging a token is the only attack surface they have.
  test('a tampered payload does not verify', () => {
    const token = signTrackingToken(claims, SECRET)
    const [body, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({
      v: 1, t: 'other-tenant', o: claims.organizationId, c: claims.campaignId, r: claims.runId, s: 's', p: 'open',
    })).toString('base64url')
    expect(verifyTrackingToken(`${forged}.${signature}`, SECRET)).toBeNull()
    expect(verifyTrackingToken(`${body}.${signature}`, SECRET)).toEqual(claims)
  })

  test('a token signed with another secret does not verify', () => {
    expect(verifyTrackingToken(signTrackingToken(claims, 'other-secret'), SECRET)).toBeNull()
  })

  test('the signing key is domain separated, so the raw secret is not the hmac key', () => {
    // Signing with a key equal to the secret itself would let anything else signed with that secret
    // be replayed as a tracking token.
    const token = signTrackingToken(claims, SECRET)
    const body = token.split('.')[0]
    const naive = require('node:crypto').createHmac('sha256', SECRET).update(body).digest('base64url')
    expect(token.split('.')[1]).not.toBe(naive)
  })

  test.each([
    ['no separator', 'justonepart'],
    ['too many parts', 'a.b.c'],
    ['an empty body', '.signature'],
    ['an empty signature', 'body.'],
    ['garbage', '!!!!.????'],
    ['an empty string', ''],
  ])('rejects %s', (_label, token) => {
    expect(verifyTrackingToken(token, SECRET)).toBeNull()
  })

  test('rejects a body that is valid base64 but not a claim set', () => {
    const body = Buffer.from('not json').toString('base64url')
    const signature = require('node:crypto')
      .createHmac('sha256', require('node:crypto').createHash('sha256').update(`${SECRET}\u0000marketing_automation:tracking:v1`).digest())
      .update(body)
      .digest('base64url')
    expect(verifyTrackingToken(`${body}.${signature}`, SECRET)).toBeNull()
  })

  test('rejects a correctly signed token from a future version', () => {
    const body = Buffer.from(JSON.stringify({ v: 2, t: 't', o: 'o', c: 'c', r: 'r', s: 's', p: 'open' })).toString('base64url')
    const signature = require('node:crypto')
      .createHmac('sha256', require('node:crypto').createHash('sha256').update(`${SECRET}\u0000marketing_automation:tracking:v1`).digest())
      .update(body)
      .digest('base64url')
    expect(verifyTrackingToken(`${body}.${signature}`, SECRET)).toBeNull()
  })
})

describe('isSafeRedirectTarget', () => {
  test.each([
    ['https://shop.example.com/x', true],
    ['http://shop.example.com/x', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['vbscript:msgbox', false],
    ['/relative/path', false],
    ['', false],
  ])('%s → %s', (target, expected) => {
    expect(isSafeRedirectTarget(target)).toBe(expected)
  })

  test('undefined is not safe', () => {
    expect(isSafeRedirectTarget(undefined)).toBe(false)
  })
})

describe('resolveTrackingSecret', () => {
  test('prefers the dedicated variable', () => {
    expect(resolveTrackingSecret({ OM_MARKETING_TRACKING_SECRET: 'a', TENANT_DATA_ENCRYPTION_KEY: 'b' })).toBe('a')
  })

  test('falls back to platform key material so tracking works without new configuration', () => {
    expect(resolveTrackingSecret({ TENANT_DATA_ENCRYPTION_KEY: 'b' })).toBe('b')
    expect(resolveTrackingSecret({ TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'c' })).toBe('c')
  })

  test('ignores an empty or whitespace value, which an env file has plenty of', () => {
    expect(resolveTrackingSecret({ OM_MARKETING_TRACKING_SECRET: '   ', TENANT_DATA_ENCRYPTION_KEY: 'b' })).toBe('b')
  })

  test('returns null when nothing is configured, which disables tracking', () => {
    expect(resolveTrackingSecret({})).toBeNull()
  })

  // A session secret must never be a candidate: the token lives in mail archives forever.
  test('never falls back to a session or jwt secret', () => {
    expect(trackingSecretEnvNames()).not.toContain('NEXTAUTH_SECRET')
    expect(trackingSecretEnvNames()).not.toContain('AUTH_SECRET')
    expect(trackingSecretEnvNames()).not.toContain('JWT_SECRET')
    expect(resolveTrackingSecret({ AUTH_SECRET: 'x', JWT_SECRET: 'y', NEXTAUTH_SECRET: 'z' })).toBeNull()
  })
})
