import { registerCommand, type CommandHandler, type CommandLogMetadata, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { Incident, IncidentTimelineEntry } from '../data/entities'
import { timelineAddSchema, type TimelineAddInput } from '../data/collab-validators'
import { emitIncidentsEvent } from '../events'
import {
  emitIncidentSideEffects,
  resolveActorUserId,
  resolveCommandScope,
  type IncidentScope,
} from './incident'
import {
  assertIncidentMutable,
  assertIncidentNotMerged,
  emitIncidentCustomerUpdated,
  resolveIncidentAccountTargetIds,
} from './actions'

type TimelineAddResult = {
  entryId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt: Date
}

const timelineEntryIndexer: CrudIndexerConfig<IncidentTimelineEntry> = {
  entityType: E.incidents.incident_timeline_entry,
}

async function loadIncidentForTimeline(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<Incident> {
  const incident = await findOneWithDecryption(
    em,
    Incident,
    { id, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  if (!incident) throw new CrudHttpError(404, { error: '[internal] incident not found' })
  return incident
}

async function enforceIncidentOptimisticLock(
  ctx: CommandRuntimeContext,
  incident: Incident,
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: 'incidents.incident',
    resourceId: incident.id,
    current: incident.updatedAt,
    request: ctx.request ?? null,
  })
}

async function emitTimelineEntrySideEffects(
  ctx: CommandRuntimeContext,
  entry: IncidentTimelineEntry,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'created',
    entity: entry,
    identifiers: {
      id: entry.id,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
    },
    indexer: timelineEntryIndexer,
  })
  await emitIncidentsEvent(
    'incidents.timeline_entry.added',
    {
      id: entry.id,
      incidentId: entry.incidentId,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
      kind: entry.kind,
      visibility: entry.visibility,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    },
    { persistent: true },
  )
}

async function buildTimelineLog(result: TimelineAddResult): Promise<CommandLogMetadata> {
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate('incidents.audit.timeline.add', 'Add timeline entry'),
    resourceKind: 'incidents.timeline_entry',
    resourceId: result.entryId,
    parentResourceKind: 'incidents.incident',
    parentResourceId: result.incidentId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    context: {
      appendOnly: true,
      undoable: false,
    },
  }
}

const addTimelineEntryCommand: CommandHandler<TimelineAddInput, TimelineAddResult> = {
  id: 'incidents.timeline_entries.add',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = timelineAddSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForTimeline(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    assertIncidentMutable(incident)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let entry!: IncidentTimelineEntry
    await withAtomicFlush(em, [
      () => {
        entry = em.create(IncidentTimelineEntry, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          incidentId: incident.id,
          kind: parsed.kind ?? 'note',
          actorUserId,
          body: parsed.body ?? null,
          visibility: parsed.visibility ?? 'internal',
          metadata: null,
          createdAt: now,
        })
        em.persist(entry)
        incident.updatedAt = now
        em.persist(incident)
      },
    ], { transaction: true })

    await emitTimelineEntrySideEffects(ctx, entry)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    if (entry.visibility === 'customer_facing') {
      const accountTargetIds = await resolveIncidentAccountTargetIds(em, scope, incident.id)
      await emitIncidentCustomerUpdated(ctx, incident, accountTargetIds)
    }

    return {
      entryId: entry.id,
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  buildLog: ({ result }) => buildTimelineLog(result),
}

registerCommand(addTimelineEntryCommand)
