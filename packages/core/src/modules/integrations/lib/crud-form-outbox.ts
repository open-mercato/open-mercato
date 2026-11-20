import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import {
  collectCrudFormSectionOutboxRuntimes,
  crudFormSectionOutboxJobSchema,
  crudFormSectionOutboxKey,
  crudFormSectionOutboxQueue,
  type CrudFormSectionOutboxIdentity,
  type CrudFormSectionOutboxScope,
  type CrudFormSectionOutboxServices,
} from '@open-mercato/shared/lib/crud/form-sections/outbox'
import { getCrudFormSectionManifest } from '@open-mercato/shared/lib/crud/form-sections/manifest'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isEventDeclared } from '@open-mercato/shared/modules/events'
import type { NotificationService } from '../../notifications/lib/notificationService'
import { SyncExternalIdMapping } from '../data/entities'
import type { IntegrationLogService } from './log-service'

let outboxQueue: Queue<CrudFormSectionOutboxIdentity> | undefined

export function getCrudFormSectionOutboxRuntimes() {
  return collectCrudFormSectionOutboxRuntimes(getCrudFormSectionManifest().sinkRuntimes?.values() ?? [])
}

export function createCrudFormSectionOutboxService(container: AwilixContainer): CrudFormSectionOutboxServices {
  return {
    async credentials(integrationId, scope) {
      return await container.resolve<{
        resolve(id: string, scope: CrudFormSectionOutboxScope): Promise<Record<string, unknown> | null>
      }>('integrationCredentialsService').resolve(integrationId, scope)
    },
    async enqueue(identity, delayMs) {
      outboxQueue ??= createModuleQueue(crudFormSectionOutboxQueue, {
        concurrency: 3, coalesceBy: crudFormSectionOutboxKey,
      })
      await outboxQueue.enqueue(crudFormSectionOutboxJobSchema.parse(identity), { delayMs })
    },
    async recordMapping(em, { identity, integrationId, externalId, operation }) {
      const id = z.uuid().safeParse(identity.hostId)
      if (!id.success) throw new Error('[internal] Invalid host identity for outbox mapping')
      const scope = { tenantId: identity.tenantId, organizationId: identity.organizationId }
      const where = { ...scope, integrationId, internalEntityType: `crud_form_section_sink:${identity.sinkId}`, internalEntityId: id.data }
      await em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
        `crudform_outbox_mapping:${JSON.stringify(where)}`,
      ])
      const mapping = await findOneWithDecryption(em, SyncExternalIdMapping, where, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      if (operation === 'delete') {
        if (mapping && !mapping.deletedAt) mapping.deletedAt = new Date()
      } else if (externalId) {
        const now = new Date()
        if (mapping) {
          Object.assign(mapping, { externalId, lastSyncedAt: now, syncStatus: 'synced', deletedAt: null })
        } else {
          em.create(SyncExternalIdMapping, { ...where, externalId, lastSyncedAt: now, syncStatus: 'synced' })
        }
      }
    },
    async reportOutcome({ identity, integrationId, resourceKind, status, actorId, code, failureNotificationType, failure }) {
      const scope = { tenantId: identity.tenantId, organizationId: identity.organizationId }
      if (failure?.effect === 'event') {
        const event = `${identity.sinkId.replace(':', '.')}.sync_failed`
        if (!container.hasRegistration('eventBus') || !isEventDeclared(event)) {
          throw new Error('[internal] Outbox failure event unavailable')
        }
        const bus = container.resolve<EventBus>('eventBus')
        await bus.emit(event, {
          ...scope, id: identity.hostId, actorUserId: actorId, errorCode: code, failureReportId: failure.reportId,
        }, { ...scope, persistent: true, skipPersistentSubscribersInline: true, rethrowHandlerErrors: true })
      } else if (failure?.effect === 'notification') {
        if (!actorId || !container.hasRegistration('notificationService')) {
          throw new Error('[internal] Outbox failure notification unavailable')
        }
        await container.resolve<NotificationService>('notificationService').createBatch({
          type: failureNotificationType, recipientUserIds: [actorId],
          titleKey: `${failureNotificationType}.title`, severity: 'error', channels: ['in_app'],
          groupKey: `crud_form_outbox_failure:${failure.reportId}`,
          sourceModule: identity.sinkId.split(/[.:]/)[0], sourceEntityType: resourceKind,
          sourceEntityId: identity.hostId,
        }, scope, { skipExistingGroup: true })
      } else {
        await container.resolve<IntegrationLogService>('integrationLogService').write({
          integrationId, scopeEntityType: resourceKind, scopeEntityId: identity.hostId,
          level: status === 'failed' ? 'error' : status === 'pending' ? 'warn' : 'info',
          message: status === 'synced' ? 'CrudForm extension delivery completed' : 'CrudForm extension delivery failed',
          code: code ?? 'crud_form_section_delivery_synced',
          ...(failure ? { payload: { failureReportId: failure.reportId } } : {}),
        }, scope)
      }
    },
  }
}

export async function sweepCrudFormSectionOutbox(
  em: EntityManager, service: CrudFormSectionOutboxServices, scope: CrudFormSectionOutboxScope,
): Promise<void> {
  for (const [sinkId, sink] of getCrudFormSectionOutboxRuntimes()) {
    if (!sink.outbox) continue
    const due = await sink.outbox.mirror.listDue(em, scope, new Date(), 100)
    for (const hostId of due) {
      const result = crudFormSectionOutboxJobSchema.safeParse({ ...scope, sinkId, hostId })
      if (result.success) await service.enqueue(result.data)
    }
  }
}
