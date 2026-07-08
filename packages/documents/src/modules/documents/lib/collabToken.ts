import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { DocumentTier } from '../lib/permissions'

export const COLLAB_TOKEN_AUDIENCE = 'documents-collab'
export const COLLAB_TOKEN_TTL_SECONDS = 60

export type CollabTokenClaims = {
  userId: string
  tenantId: string
  organizationId: string
  documentId: string
  tier: DocumentTier
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDocumentTier(value: unknown): value is DocumentTier {
  return value === 'owner' || value === 'editor' || value === 'commenter' || value === 'viewer'
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

  const claims = payload as Record<string, unknown>
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
