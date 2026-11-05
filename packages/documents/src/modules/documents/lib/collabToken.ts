import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { DocumentTier } from '../lib/permissions'

export const COLLAB_TOKEN_AUDIENCE = 'documents-collab'
export const COLLAB_TOKEN_V2_AUDIENCE = 'documents-collab-v2'
export const COLLAB_TOKEN_TTL_SECONDS = 60
export const COLLAB_TOKEN_CLOCK_SKEW_SECONDS = 5
export const COLLAB_TOKEN_V2_MIN_SECRET_BYTES = 32

export type CollabTokenClaims = {
  userId: string
  tenantId: string
  organizationId: string
  documentId: string
  tier: DocumentTier
}

export type CollabTokenV2MintInput = CollabTokenClaims & {
  tokenVersion: 2
  readOnly: boolean
}

export type VerifiedCollabTokenV2Claims = CollabTokenV2MintInput & {
  exp: number
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDocumentTier(value: unknown): value is DocumentTier {
  return value === 'owner' || value === 'editor' || value === 'commenter' || value === 'viewer'
}

function readV2Secret(): string | null {
  const secret = process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2?.trim()
  if (!secret || new TextEncoder().encode(secret).byteLength < COLLAB_TOKEN_V2_MIN_SECRET_BYTES) {
    return null
  }
  const explicitV1Secret = process.env.DOCUMENTS_COLLAB_JWT_SECRET?.trim()
  return explicitV1Secret === secret ? null : secret
}

export function isCollabTokenV2Ready(): boolean {
  return readV2Secret() !== null
}

function requireV2Secret(): string {
  const secret = readV2Secret()
  if (!secret) {
    throw new Error(
      `[internal] DOCUMENTS_COLLAB_JWT_SECRET_V2 must contain at least ${COLLAB_TOKEN_V2_MIN_SECRET_BYTES} UTF-8 bytes and differ from DOCUMENTS_COLLAB_JWT_SECRET`,
    )
  }
  return secret
}

function readCommonClaims(claims: Record<string, unknown>): CollabTokenClaims | null {
  const { userId, tenantId, organizationId, documentId, tier } = claims
  if (
    !isNonEmptyString(userId)
    || !isNonEmptyString(tenantId)
    || !isNonEmptyString(organizationId)
    || !isNonEmptyString(documentId)
    || !isDocumentTier(tier)
  ) {
    return null
  }

  return { userId, tenantId, organizationId, documentId, tier }
}

export function mintCollabToken(claims: CollabTokenClaims): string {
  return signJwt(
    { ...claims, sub: claims.userId },
    {
      audience: COLLAB_TOKEN_AUDIENCE,
      secret: process.env.DOCUMENTS_COLLAB_JWT_SECRET,
      expiresInSec: COLLAB_TOKEN_TTL_SECONDS,
    },
  )
}

/**
 * Legacy v1 acceptance is a rollout bridge only. Nothing mints v1 tokens
 * anymore, so the sidecar accepts them solely while a dedicated
 * DOCUMENTS_COLLAB_JWT_SECRET is explicitly configured and at least as strong
 * as the v2 minimum. Default deployments (derived JWT_SECRET fallback) accept
 * v2 tokens exclusively.
 */
export function resolveLegacyCollabTokenVerifier(
  env: Record<string, string | undefined> = process.env,
): ((token: string) => CollabTokenClaims | null) | null {
  const secret = env.DOCUMENTS_COLLAB_JWT_SECRET?.trim()
  if (!secret || new TextEncoder().encode(secret).byteLength < COLLAB_TOKEN_V2_MIN_SECRET_BYTES) {
    return null
  }
  return verifyCollabToken
}

export function verifyCollabToken(token: string): CollabTokenClaims | null {
  let payload: unknown
  try {
    payload = verifyJwt(token, {
      audience: COLLAB_TOKEN_AUDIENCE,
      secret: process.env.DOCUMENTS_COLLAB_JWT_SECRET,
    })
  } catch {
    return null
  }

  if (!payload || typeof payload !== 'object') return null

  return readCommonClaims(payload as Record<string, unknown>)
}

export function mintCollabTokenV2(claims: CollabTokenV2MintInput): string {
  return signJwt(
    { ...claims, sub: claims.userId },
    {
      audience: COLLAB_TOKEN_V2_AUDIENCE,
      secret: requireV2Secret(),
      expiresInSec: COLLAB_TOKEN_TTL_SECONDS,
    },
  )
}

export function verifyCollabTokenV2(token: string): VerifiedCollabTokenV2Claims | null {
  const secret = readV2Secret()
  if (!secret) return null

  let payload: unknown
  try {
    payload = verifyJwt(token, {
      audience: COLLAB_TOKEN_V2_AUDIENCE,
      secret,
    })
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null

  const claims = payload as Record<string, unknown>
  const common = readCommonClaims(claims)
  const { exp, iat, readOnly, tokenVersion } = claims
  const now = Math.floor(Date.now() / 1000)
  if (
    !common
    || tokenVersion !== 2
    || typeof readOnly !== 'boolean'
    || typeof exp !== 'number'
    || !Number.isInteger(exp)
    || typeof iat !== 'number'
    || !Number.isInteger(iat)
    || exp <= now
    || exp <= iat
    || exp - iat > COLLAB_TOKEN_TTL_SECONDS
    || iat > now + COLLAB_TOKEN_CLOCK_SKEW_SECONDS
    || exp > now + COLLAB_TOKEN_TTL_SECONDS + COLLAB_TOKEN_CLOCK_SKEW_SECONDS
  ) {
    return null
  }

  return {
    ...common,
    tokenVersion,
    readOnly,
    exp,
  }
}
