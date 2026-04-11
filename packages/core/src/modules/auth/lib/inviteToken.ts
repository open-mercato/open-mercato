import { getSecurityEmailBaseUrl } from '@open-mercato/shared/lib/url'

export const INVITE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000

export function resolveInviteBaseUrl(requestUrl?: string): string {
  return getSecurityEmailBaseUrl(requestUrl)
}
