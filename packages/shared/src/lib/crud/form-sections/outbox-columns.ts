import { BigIntType, LockMode, type EntityClass } from '@mikro-orm/core'
import { Entity, Property } from '@mikro-orm/decorators/legacy'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '../../encryption/find'
import type { CrudFormSectionOutboxFailureReport, CrudFormSectionOutboxIdentity, CrudFormSectionOutboxMirror, CrudFormSectionOutboxRow, CrudFormSectionOutboxScope } from './outbox'

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

  @Property({ name: 'delivery_integration_id', type: 'text' })
  deliveryIntegrationId!: string

  @Property({ name: 'delivery_contract_id', type: 'text' })
  deliveryContractId!: string

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'pending_operation', type: 'text' })
  pendingOperation!: 'upsert' | 'delete' | 'restore'

  @Property({ name: 'delivery_actor_id', type: 'uuid', nullable: true })
  deliveryActorId: string | null = null

  @Property({ name: 'failure_reports', type: 'jsonb', defaultRaw: "'[]'::jsonb" })
  failureReports: CrudFormSectionOutboxFailureReport[] = []

  @Property({ name: 'next_failure_report_at', type: Date, nullable: true })
  nextFailureReportAt: Date | null = null
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
        deliveryIntegrationId: prior.deliveryIntegrationId, deliveryContractId: prior.deliveryContractId,
        idempotencyKey: prior.idempotencyKey, pendingOperation: prior.pendingOperation,
        syncStatus: status, syncAttempts: prior.syncAttempts,
        lastAttemptAt: prior.lastAttemptAt, nextAttemptAt: prior.nextAttemptAt, nextFailureReportAt: prior.nextFailureReportAt,
      }
      return await em.nativeUpdate(entity, where, changes) === 1
    },
    async listDue(em: EntityManager, scope: CrudFormSectionOutboxScope, now: Date, limit: number) {
      const reportLimit = Math.floor(limit / 2)
      const deliveries = await em.find(entity, { ...scope, syncStatus: 'pending', nextAttemptAt: { $lte: now } }, {
        fields: ['hostId'], limit: limit - reportLimit, orderBy: { nextAttemptAt: 'ASC', id: 'ASC' },
      })
      const reports = reportLimit ? await em.find(entity, { ...scope, nextFailureReportAt: { $lte: now } }, {
        fields: ['hostId'], limit: reportLimit, orderBy: { nextFailureReportAt: 'ASC', id: 'ASC' },
      }) : []
      return [...new Set([...deliveries, ...reports].map(({ hostId }) => hostId))]
    },
  }
}
