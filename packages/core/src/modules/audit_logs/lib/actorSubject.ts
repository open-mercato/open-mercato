import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

export const ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY = 'actorSubject'
export const API_KEY_ACTOR_PREFIX = 'api_key:'

const UUID_PATTERN = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

export type CanonicalActorSubject = {
  kind: 'api_key' | 'user'
  storageId: string
  subject: string
}

export function canonicalizeActorSubject(value: unknown): CanonicalActorSubject | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate) return null
  if (candidate.startsWith(API_KEY_ACTOR_PREFIX)) {
    const storageId = candidate.slice(API_KEY_ACTOR_PREFIX.length)
    if (!UUID_PATTERN.test(storageId)) return null
    return { kind: 'api_key', storageId, subject: `${API_KEY_ACTOR_PREFIX}${storageId}` }
  }
  if (!UUID_PATTERN.test(candidate)) return null
  return { kind: 'user', storageId: candidate, subject: candidate }
}

export function resolveActionLogActorSubject(
  log: Pick<CommandUndoLogEntry, 'actorUserId' | 'contextJson'>,
): string | null {
  const storedActor = canonicalizeActorSubject(log.actorUserId)
  const storedSubject = storedActor?.kind === 'user'
    ? storedActor.subject
    : typeof log.actorUserId === 'string' && log.actorUserId.length > 0 && !log.actorUserId.startsWith(API_KEY_ACTOR_PREFIX)
      ? log.actorUserId
      : null
  if (!storedSubject) return null
  const contextSubject = log.contextJson?.[ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY]
  if (contextSubject === undefined) return storedSubject
  const canonicalContextSubject = canonicalizeActorSubject(contextSubject)
  if (!canonicalContextSubject || canonicalContextSubject.storageId !== storedSubject) return null
  return canonicalContextSubject.subject
}

export function actionLogBelongsToSubject(
  log: Pick<CommandUndoLogEntry, 'actorUserId' | 'contextJson'>,
  subject: unknown,
): boolean {
  const canonicalSubject = canonicalizeActorSubject(subject)
  return Boolean(canonicalSubject && resolveActionLogActorSubject(log) === canonicalSubject.subject)
}

export function resolveCanonicalAuthSubject(auth: NonNullable<AuthContext>): CanonicalActorSubject | null {
  const subject = canonicalizeActorSubject(auth.sub)
  if (typeof auth.sub !== 'string' || auth.sub.length === 0) return null
  if (auth.sub.startsWith(API_KEY_ACTOR_PREFIX)) {
    if (!subject || subject.kind !== 'api_key') return null
    const key = canonicalizeActorSubject(
      typeof auth.keyId === 'string' ? `${API_KEY_ACTOR_PREFIX}${auth.keyId}` : null,
    )
    if (auth.isApiKey !== true || !key || key.subject !== subject.subject) return null
    return subject
  }
  if (auth.isApiKey === true || auth.keyId !== undefined) return null
  return subject ?? { kind: 'user', storageId: auth.sub, subject: auth.sub }
}

export function actionLogBelongsToAuth(
  log: Pick<CommandUndoLogEntry, 'actorUserId' | 'contextJson'>,
  auth: NonNullable<AuthContext>,
): boolean {
  const authSubject = resolveCanonicalAuthSubject(auth)
  if (!authSubject) return false
  const contextSubject = log.contextJson?.[ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY]
  if (contextSubject !== undefined) {
    return actionLogBelongsToSubject(log, authSubject.subject)
  }
  if (authSubject.kind === 'api_key') {
    return log.actorUserId === authSubject.storageId
  }
  return log.actorUserId === authSubject.subject
}
