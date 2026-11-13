import { createHash } from 'node:crypto'
import type { CacheStrategy } from '@open-mercato/cache'
import { runWithCacheTenant } from '@open-mercato/cache'

export const SCIM_ADMISSION_TTL_MS = 30_000

export function scimTokenLookupHash(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export function scimAdmissionCacheKey(rawToken: string): string {
  return `sso:scim-admission:${scimTokenLookupHash(rawToken)}`
}

export function scimAdmissionTokenKey(token: { id: string; tenantId?: string | null; organizationId: string }): string {
  return `token:${token.tenantId ?? 'global'}:${token.organizationId}:${token.id}`
}

export function scimAdmissionTokenTag(tokenId: string): string {
  return `sso:scim-admission:token:${tokenId}`
}

export async function readScimAdmissionKey(cache: CacheStrategy, rawToken: string): Promise<string | null> {
  const cached = await runWithCacheTenant(null, () => cache.get(scimAdmissionCacheKey(rawToken)))
  return typeof cached === 'string' && cached.startsWith('token:') ? cached : null
}
