import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

/**
 * Resolves the acting user id for device routes. Device ownership is per-user, so API-key
 * principals (which have no human user) are not valid device actors and yield null. Mirrors the
 * `auth.isApiKey ? null : auth.sub` convention used across the codebase; the target user id is
 * validated as a UUID by the command schemas downstream.
 */
export function resolveDeviceActorUserId(auth: AuthContext | null): string | null {
  if (!auth || auth.isApiKey) return null
  const subjectId = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  return subjectId || null
}
