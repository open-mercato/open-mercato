import type { EntityManager } from '@mikro-orm/postgresql'

export function lockSignInAttempt(em: EntityManager, tenantId: string, attemptId: string) {
  return em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [
    `security:sign-in:attempt:${tenantId}:${attemptId}`,
  ])
}

export function lockSignInDevice(em: EntityManager, tenantId: string, userId: string) {
  return em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [
    `security:sign-in:device:${tenantId}:${userId}`,
  ])
}
