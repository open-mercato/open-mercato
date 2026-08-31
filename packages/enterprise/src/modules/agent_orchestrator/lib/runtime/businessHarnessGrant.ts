import { randomUUID } from 'node:crypto'
import { signAudienceJwt, verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

export const BUSINESS_HARNESS_GRANT_AUDIENCE = 'business-harness-run'

export type BusinessHarnessGrantClaims = {
  jti: string
  runId: string
  agentId: string
  agentDigest: string
  tenantId: string
  organizationId: string
  userId: string
  model: {
    audience: string
    bindingId: string
    providerId: string
  }
  capability: {
    audience: string
    bindingId: string
    sessionToken: string
  }
  iat: number
  exp: number
  aud?: string
  iss?: string
}

export function issueBusinessHarnessRunGrant(input: {
  runId: string
  agentId: string
  agentDigest: string
  tenantId: string
  organizationId: string
  userId: string
  model: BusinessHarnessGrantClaims['model']
  capability: BusinessHarnessGrantClaims['capability']
  ttlMs: number
}): { token: string; expiresAt: Date } {
  const ttlSeconds = Math.max(10, Math.ceil(input.ttlMs / 1000))
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const token = signAudienceJwt(
    BUSINESS_HARNESS_GRANT_AUDIENCE,
    {
      jti: randomUUID(),
      runId: input.runId,
      agentId: input.agentId,
      agentDigest: input.agentDigest,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: input.userId,
      model: input.model,
      capability: input.capability,
    },
    ttlSeconds,
  )
  return { token, expiresAt }
}

export function verifyBusinessHarnessRunGrant(token: string): BusinessHarnessGrantClaims | null {
  const raw = verifyAudienceJwt(BUSINESS_HARNESS_GRANT_AUDIENCE, token)
  if (!isRecord(raw)) return null
  if (
    !isString(raw.jti) ||
    !isString(raw.runId) ||
    !isString(raw.agentId) ||
    !isString(raw.agentDigest) ||
    !isString(raw.tenantId) ||
    !isString(raw.organizationId) ||
    !isString(raw.userId) ||
    !isFiniteNumber(raw.iat) ||
    !isFiniteNumber(raw.exp) ||
    !isModelClaim(raw.model) ||
    !isCapabilityClaim(raw.capability)
  ) {
    return null
  }
  return raw as BusinessHarnessGrantClaims
}

function isModelClaim(value: unknown): value is BusinessHarnessGrantClaims['model'] {
  return (
    isRecord(value) &&
    isString(value.audience) &&
    isString(value.bindingId) &&
    isString(value.providerId)
  )
}

function isCapabilityClaim(value: unknown): value is BusinessHarnessGrantClaims['capability'] {
  return (
    isRecord(value) &&
    isString(value.audience) &&
    isString(value.bindingId) &&
    isString(value.sessionToken)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
