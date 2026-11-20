import { BigIntType, LockMode, type EntityClass } from '@mikro-orm/core'
import { Entity, Property } from '@mikro-orm/decorators/legacy'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '../../encryption/find'
import type { CrudFormSectionOutboxIdentity, CrudFormSectionOutboxMirror, CrudFormSectionOutboxRow, CrudFormSectionOutboxScope } from './outbox'

@Entity({ abstract: true })
abstract class OutboxColumns {
  @Property({ name: 'sync_status', type: 'text' })
  syncStatus: 'pending' | 'synced' | 'failed' = 'pending'

  @Property({ name: 'sync_attempts', type: 'integer' })
  syncAttempts = 0

  @Property({ name: 'next_attempt_at', type: Date, nullable: true })
  nextAttemptAt: Date | null = null

  @Property({ name: 'last_attempt_at', type: Date, nullable: true })
  lastAttemptAt: Date | null = null

  @Property({ name: 'last_error_code', type: 'text', nullable: true })
  lastErrorCode: CrudFormSectionOutboxRow['lastErrorCode'] = null

  @Property({ name: 'external_id', type: 'text', nullable: true })
  externalId: string | null = null

  @Property({ name: 'delivery_revision', type: new BigIntType('string') })
  deliveryRevision!: string

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'pending_operation', type: 'text' })
  pendingOperation!: 'upsert' | 'delete' | 'restore'

  @Property({ name: 'delivery_actor_id', type: 'uuid', nullable: true })
  deliveryActorId: string | null = null
}

export { OutboxColumns as outboxColumns }

type MirrorRecord = OutboxColumns & Omit<CrudFormSectionOutboxRow, keyof OutboxColumns>

export function createCrudFormSectionOutboxMirror(
  entity: EntityClass<MirrorRecord>,
): CrudFormSectionOutboxMirror {
  const scoped = ({ tenantId, organizationId, hostId }: CrudFormSectionOutboxIdentity) =>
    ({ tenantId, organizationId, hostId })
  return {
    async read(em, identity, locked) {
      const where = scoped(identity)
      return findOneWithDecryption(em, entity, where, {
        refresh: true, ...(locked ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
      }, where)
    },
    async write(em, identity, row, intent) {
      if (row) {
        Object.assign(row, intent)
      } else {
        em.create(entity, { ...scoped(identity), ...intent }, { partial: true, persist: true })
      }
    },
    async compareAndSet(em, identity, prior, status, changes) {
      const where = {
        ...scoped(identity), id: prior.id, deliveryRevision: prior.deliveryRevision,
        syncStatus: status, syncAttempts: prior.syncAttempts,
        lastAttemptAt: prior.lastAttemptAt, nextAttemptAt: prior.nextAttemptAt,
      }
      return await em.nativeUpdate(entity, where, changes) === 1
    },
    async listDue(em: EntityManager, scope: CrudFormSectionOutboxScope, now: Date, limit: number) {
      const where = { ...scope, syncStatus: 'pending' as const, nextAttemptAt: { $lte: now } }
      const due = await em.find(entity, where, {
        fields: ['hostId'], limit, orderBy: { nextAttemptAt: 'ASC', id: 'ASC' },
      })
      return due.map(({ hostId }) => hostId)
    },
  }
}
