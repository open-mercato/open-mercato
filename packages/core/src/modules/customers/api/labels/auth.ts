import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function resolveLabelActorUserId(auth: AuthContext): string | null {
  if (!auth) return null

  const apiUserId = typeof auth.userId === 'string' ? auth.userId.trim() : ''
  if (apiUserId && uuidRegex.test(apiUserId)) {
    return apiUserId
  }

  if (auth.isApiKey) {
    return null
  }

  const subjectId = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  return subjectId && uuidRegex.test(subjectId) ? subjectId : null
}
