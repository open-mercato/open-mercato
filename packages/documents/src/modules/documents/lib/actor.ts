import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const actorUuidSchema = z.string().uuid()

function normalizeActorUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return actorUuidSchema.safeParse(normalized).success ? normalized : null
}

function isApiKeyAuth(auth: NonNullable<AuthContext>): boolean {
  return auth.isApiKey === true || auth.sub.trim().startsWith('api_key:')
}

export function resolveActorUserId(auth: NonNullable<AuthContext>): string {
  const subject = auth.sub.trim()
  if (isApiKeyAuth(auth)) {
    // `keyId` is populated only by successful API-key authentication. Do not
    // recover an actor by parsing an arbitrary prefixed subject when that
    // validated field is absent, malformed, or disagrees with the subject.
    const keyId = normalizeActorUuid(auth.keyId)
    if (!keyId || subject !== `api_key:${keyId}`) {
      throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
    }
    if (auth.userId === undefined || auth.userId === null) return keyId
    const backingUserId = normalizeActorUuid(auth.userId)
    if (backingUserId) return backingUserId
    throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
  }

  const actorUserId = normalizeActorUuid(subject)
  const claimedUserId = auth.userId === undefined || auth.userId === null
    ? actorUserId
    : normalizeActorUuid(auth.userId)
  if (actorUserId && claimedUserId === actorUserId) return actorUserId
  throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
}

