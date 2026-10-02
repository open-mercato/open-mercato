import {
  isSafeRedirectTarget,
  signTrackingToken,
  verifyTrackingToken,
  verifyTrackingTokenWithAny,
} from '../token'
import type { TrackingClaims } from '../token'
import { resolveTrackingSecret, resolveTrackingSecrets, trackingSecretEnvNames } from '../secret'

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
  test('reads the dedicated variable', () => {
    expect(resolveTrackingSecret({ OM_MARKETING_TRACKING_SECRET: 'a' })).toBe('a')
  })

  /**
   * The forgery hole this resolver used to have.
   *
   * `.env.example` publishes the fallback key as a constant, so accepting it as a signing candidate
   * meant anyone could mint a token the public routes would honour.
   */
  test('never signs with platform encryption key material', () => {
    expect(trackingSecretEnvNames()).not.toContain('TENANT_DATA_ENCRYPTION_KEY')
    expect(trackingSecretEnvNames()).not.toContain('TENANT_DATA_ENCRYPTION_FALLBACK_KEY')
    expect(resolveTrackingSecret({
      TENANT_DATA_ENCRYPTION_KEY: 'b',
      TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'dev-tenant-encryption-fallback-key-32chars',
    })).toBeNull()
  })

  test('refuses a secret this repository publishes, even in the dedicated variable', () => {
    expect(resolveTrackingSecret({
      OM_MARKETING_TRACKING_SECRET: 'dev-tenant-encryption-fallback-key-32chars',
    })).toBeNull()
    expect(resolveTrackingSecret({ OM_MARKETING_TRACKING_SECRET: 'change-me-dev-secret' })).toBeNull()
    expect(resolveTrackingSecret({ OM_MARKETING_TRACKING_SECRET: 'CHANGE-ME-anything' })).toBeNull()
  })

  test('ignores an empty or whitespace value, which an env file has plenty of', () => {
    expect(resolveTrackingSecret({ OM_MARKETING_TRACKING_SECRET: '   ' })).toBeNull()
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

describe('signature malleability', () => {
  const secret = 'test-secret-value'
  const claims = {
    tenantId: 't1',
    organizationId: 'o1',
    campaignId: 'c1',
    runId: 'r1',
    stepId: 's1',
    purpose: 'survey' as const,
    target: '9',
  }

  test('a valid signature followed by padding and arbitrary text is refused', () => {
    /**
     * `Buffer.from(…, 'base64')` stops at `=` and discards the rest, so this token used to verify: the decoded
     * signature was byte-identical and `timingSafeEqual` passed. That made the signature an unbounded slot for
     * attacker-controlled characters, and the survey page echoed the token into an HTML attribute — a reflected
     * XSS on the application's own origin.
     */
    const token = signTrackingToken(claims, secret)
    const forged = `${token}="><svg onload=alert(1)>`
    expect(verifyTrackingToken(forged, secret)).toBeNull()
  })

  test('trailing padding alone is refused, even without a payload', () => {
    // The canonical form our encoder produces has no `=` at all, so accepting one accepts a shape we never mint.
    expect(verifyTrackingToken(`${signTrackingToken(claims, secret)}=`, secret)).toBeNull()
  })

  test('a character outside the base64url alphabet is refused in either half', () => {
    const [body, signature] = signTrackingToken(claims, secret).split('.')
    expect(verifyTrackingToken(`${body}+.${signature}`, secret)).toBeNull()
    expect(verifyTrackingToken(`${body}.${signature}+`, secret)).toBeNull()
    expect(verifyTrackingToken(`${body}.${signature} `, secret)).toBeNull()
  })

  test('the canonical token we mint still verifies, for every purpose', () => {
    for (const purpose of ['open', 'click', 'unsubscribe', 'survey'] as const) {
      const minted = signTrackingToken({ ...claims, purpose }, secret)
      expect(minted).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      expect(verifyTrackingToken(minted, secret)?.purpose).toBe(purpose)
    }
  })
})

/**
 * Key rotation, which a tracking token has to survive by design.
 *
 * These tokens deliberately never expire — an unsubscribe link must keep working for as long as the message it is
 * in exists in somebody's mailbox — so the moment a platform key was rotated, every unsubscribe and survey link
 * already delivered stopped verifying. Silently, and in the one place a failure is least acceptable: a person
 * trying to be left alone.
 */
describe('verifying across a key rotation', () => {
  const claims = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    campaignId: '33333333-3333-4333-8333-333333333333',
    runId: '44444444-4444-4444-8444-444444444444',
    stepId: 'step-1',
    purpose: 'unsubscribe' as const,
  }

  test('a link minted with the previous key still verifies', () => {
    const old = signTrackingToken(claims, 'the-old-key')
    // Current key first, previous second — which is the order the resolver returns them in.
    expect(verifyTrackingTokenWithAny(old, ['the-new-key', 'the-old-key'])).not.toBeNull()
  })

  test('a link minted with the current key verifies on the first try', () => {
    const fresh = signTrackingToken(claims, 'the-new-key')
    expect(verifyTrackingTokenWithAny(fresh, ['the-new-key', 'the-old-key'])).not.toBeNull()
  })

  test('a key that was never in use verifies nothing', () => {
    const forged = signTrackingToken(claims, 'a-key-nobody-configured')
    expect(verifyTrackingTokenWithAny(forged, ['the-new-key', 'the-old-key'])).toBeNull()
  })

  test('no configured secrets verifies nothing, rather than everything', () => {
    const fresh = signTrackingToken(claims, 'the-new-key')
    expect(verifyTrackingTokenWithAny(fresh, [])).toBeNull()
  })
})

/**
 * The resolver's own contract, which is what makes the rotation above possible.
 */
describe('resolveTrackingSecrets', () => {
  test('accepts the current secret and the previous one, current first', () => {
    const secrets = resolveTrackingSecrets({
      OM_MARKETING_TRACKING_SECRET: 'current',
      OM_MARKETING_TRACKING_SECRET_PREVIOUS: 'previous',
    })
    expect(secrets).toEqual(['current', 'previous'])
  })

  test('the first is the one signing uses, so the two cannot disagree', () => {
    const env = {
      OM_MARKETING_TRACKING_SECRET: 'current',
      OM_MARKETING_TRACKING_SECRET_PREVIOUS: 'previous',
    }
    expect(resolveTrackingSecret(env)).toBe(resolveTrackingSecrets(env)[0])
  })

  test('the same key in both variables costs one HMAC, not two', () => {
    const secrets = resolveTrackingSecrets({
      OM_MARKETING_TRACKING_SECRET: 'same',
      OM_MARKETING_TRACKING_SECRET_PREVIOUS: 'same',
    })
    expect(secrets).toEqual(['same'])
  })

  /**
   * Verification is the surface the hole was exploited through, so it refuses the published
   * constants too: a rotation variable is not a way back in.
   */
  test('verifies against neither encryption key material nor a published placeholder', () => {
    expect(resolveTrackingSecrets({
      OM_MARKETING_TRACKING_SECRET: 'current',
      OM_MARKETING_TRACKING_SECRET_PREVIOUS: 'dev-tenant-encryption-fallback-key-32chars',
      TENANT_DATA_ENCRYPTION_KEY: 'b',
      TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'c',
    })).toEqual(['current'])
  })

  test('nothing configured means no secrets, which disables tracking rather than signing with a constant', () => {
    expect(resolveTrackingSecrets({})).toEqual([])
    expect(resolveTrackingSecret({})).toBeNull()
  })
})
