import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Resolves the acting user id for device routes. Device ownership is per-user, so API-key
 * principals (which have no human user) are not valid device actors and yield null.
 */
export function resolveDeviceActorUserId(auth: AuthContext | null): string | null {
  if (!auth) return null

  const userId = typeof auth.userId === 'string' ? auth.userId.trim() : ''
  if (userId && uuidRegex.test(userId)) return userId

  if (auth.isApiKey) return null

  const subjectId = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  return subjectId && uuidRegex.test(subjectId) ? subjectId : null
}
