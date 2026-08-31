/** @jest-environment node */
// The run grant is the ONLY credential the harness presents to the OM credential
// broker, so every claim it carries is a security boundary. These cases pin the
// rejections the broker relies on: a grant minted for another audience, a tampered
// payload, an expired token, and structurally incomplete claims.
process.env.JWT_SECRET = 'business-harness-grant-test-secret-0123456789abcdef'

import { signAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import {
  BUSINESS_HARNESS_GRANT_AUDIENCE,
  issueBusinessHarnessRunGrant,
  verifyBusinessHarnessRunGrant,
} from '../lib/runtime/businessHarnessGrant'

const RUN = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'

const MODEL = { audience: 'model:openai', bindingId: 'om-env-provider:openai', providerId: 'openai' }
const CAPABILITY = {
  audience: 'open-mercato:mcp',
  bindingId: 'open-mercato-default',
  sessionToken: 'session-token-value',
}

function issue(ttlMs = 150_000) {
  return issueBusinessHarnessRunGrant({
    runId: RUN,
    agentId: 'deals.health_check',
    agentDigest: 'a'.repeat(64),
    tenantId: TENANT,
    organizationId: ORG,
    userId: USER,
    model: MODEL,
    capability: CAPABILITY,
    ttlMs,
  })
}

function claims() {
  return {
    jti: 'grant-1',
    runId: RUN,
    agentId: 'deals.health_check',
    agentDigest: 'a'.repeat(64),
    tenantId: TENANT,
    organizationId: ORG,
    userId: USER,
    model: MODEL,
    capability: CAPABILITY,
  }
}

describe('business harness run grant', () => {
  it('round-trips the claims the broker matches a request against', () => {
    const { token, expiresAt } = issue()
    const verified = verifyBusinessHarnessRunGrant(token)

    expect(verified).not.toBeNull()
    expect(verified!.runId).toBe(RUN)
    expect(verified!.tenantId).toBe(TENANT)
    expect(verified!.organizationId).toBe(ORG)
    expect(verified!.userId).toBe(USER)
    expect(verified!.model).toEqual(MODEL)
    expect(verified!.capability).toEqual(CAPABILITY)
    // The expiry the runner reports must be the one inside the token, or the
    // broker's remaining-TTL check and the runner's deadline disagree.
    expect(verified!.exp * 1000).toBe(Math.floor(expiresAt.getTime() / 1000) * 1000)
  })

  it('rejects a token minted for a different audience', () => {
    const staffToken = signAudienceJwt('staff', claims(), 600)
    expect(verifyBusinessHarnessRunGrant(staffToken)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const { token } = issue()
    const [header, payload, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    decoded.tenantId = '99999999-9999-4999-8999-999999999999'
    const forged = Buffer.from(JSON.stringify(decoded))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    expect(verifyBusinessHarnessRunGrant(`${header}.${forged}.${signature}`)).toBeNull()
  })

  it('rejects an expired token', () => {
    const expired = signAudienceJwt(BUSINESS_HARNESS_GRANT_AUDIENCE, claims(), -60)
    expect(verifyBusinessHarnessRunGrant(expired)).toBeNull()
  })

  it('rejects a well-signed token whose claims are structurally incomplete', () => {
    const withoutCapability = { ...claims() } as Record<string, unknown>
    delete withoutCapability.capability
    expect(
      verifyBusinessHarnessRunGrant(signAudienceJwt(BUSINESS_HARNESS_GRANT_AUDIENCE, withoutCapability, 600)),
    ).toBeNull()

    const capabilityWithoutSessionToken = {
      ...claims(),
      capability: { audience: CAPABILITY.audience, bindingId: CAPABILITY.bindingId },
    }
    expect(
      verifyBusinessHarnessRunGrant(
        signAudienceJwt(BUSINESS_HARNESS_GRANT_AUDIENCE, capabilityWithoutSessionToken, 600),
      ),
    ).toBeNull()
  })

  it('rejects a malformed token instead of throwing', () => {
    expect(verifyBusinessHarnessRunGrant('not-a-jwt')).toBeNull()
    expect(verifyBusinessHarnessRunGrant('')).toBeNull()
  })

  it('never lets a caller mint a grant shorter than the floor', () => {
    const { token } = issue(0)
    const verified = verifyBusinessHarnessRunGrant(token)
    expect(verified).not.toBeNull()
    expect(verified!.exp - verified!.iat).toBeGreaterThanOrEqual(10)
  })
})
