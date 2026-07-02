import {
  registerCommand,
  type CommandHandler,
  type CommandLogMetadata,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { buildChanges, emitCrudSideEffects, snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { Incident, IncidentActionItem, IncidentImpact, IncidentLink, IncidentTimelineEntry } from '../data/entities'
import {
  incidentLinkCreateSchema,
  incidentLinkRemoveSchema,
  incidentMergeSchema,
  type IncidentLinkCreateInput,
  type IncidentLinkRemoveInput,
  type IncidentMergeInput,
} from '../data/collab-validators'
import { emitIncidentsEvent } from '../events'
import {
  emitIncidentSideEffects,
  resolveActorUserId,
  resolveCommandScope,
  type IncidentScope,
} from './incident'
import { applyIncidentCloseCascade, assertIncidentNotMerged } from './actions'
import { recomputeIncidentRevenue } from './impacts'

type LinkCommandResult = {
  linkId: string
  incidentId: string
  linkedIncidentId: string
  organizationId: string
  tenantId: string
  updatedAt: Date
  alreadyLinked?: boolean
}

type MergeCommandResult = {
  incidentId: string
  targetIncidentId: string
  organizationId: string
  tenantId: string
  updatedAt: Date
}

type LinkSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  incidentId: string
  linkedIncidentId: string
  kind: string
  createdAt: string
  deletedAt: string | null
}

type LinkUndoPayload = UndoPayload<LinkSnapshot>

const LINK_CHANGE_KEYS = ['incidentId', 'linkedIncidentId', 'kind', 'deletedAt'] as const satisfies readonly string[]

const linkIndexer: CrudIndexerConfig<IncidentLink> = {
  entityType: E.incidents.incident_link,
}

const actionItemIndexer: CrudIndexerConfig<IncidentActionItem> = {
  entityType: E.incidents.incident_action_item,
}

const impactIndexer: CrudIndexerConfig<IncidentImpact> = {
  entityType: E.incidents.incident_impact,
}

const timelineEntryIndexer: CrudIndexerConfig<IncidentTimelineEntry> = {
  entityType: E.incidents.incident_timeline_entry,
}

function optionalIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function parseOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function snapshotLink(link: IncidentLink): LinkSnapshot {
  return {
    id: link.id,
    organizationId: link.organizationId,
    tenantId: link.tenantId,
    incidentId: link.incidentId,
    linkedIncidentId: link.linkedIncidentId,
    kind: link.kind,
    createdAt: link.createdAt.toISOString(),
    deletedAt: optionalIso(link.deletedAt),
  }
}

async function loadLinkSnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<LinkSnapshot | null> {
  const link = await em.findOne(IncidentLink, {
    id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return link ? snapshotLink(link) : null
}

function applyLinkSnapshot(link: IncidentLink, snapshot: LinkSnapshot): void {
  link.organizationId = snapshot.organizationId
  link.tenantId = snapshot.tenantId
  link.incidentId = snapshot.incidentId
  link.linkedIncidentId = snapshot.linkedIncidentId
  link.kind = snapshot.kind
  link.createdAt = new Date(snapshot.createdAt)
  link.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createLinkFromSnapshot(em: EntityManager, snapshot: LinkSnapshot): IncidentLink {
  const link = em.create(IncidentLink, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    incidentId: snapshot.incidentId,
    linkedIncidentId: snapshot.linkedIncidentId,
    kind: snapshot.kind,
    createdAt: new Date(snapshot.createdAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(link)
  return link
}

async function loadIncidentForLink(
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

async function loadTargetIncidentForMerge(
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
  if (!incident) {
    throw new CrudHttpError(409, { error: '[internal] merge_invalid', message: '[internal] target_missing' })
  }
  return incident
}

function mergeInvalid(message: string): never {
  throw new CrudHttpError(409, { error: '[internal] merge_invalid', message })
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

function appendTimelineEntry(input: {
  em: EntityManager
  scope: IncidentScope
  incidentId: string
  kind: string
  actorUserId: string
  metadata: Record<string, unknown> | null
  now: Date
}): IncidentTimelineEntry {
  const entry = input.em.create(IncidentTimelineEntry, {
    organizationId: input.scope.organizationId,
    tenantId: input.scope.tenantId,
    incidentId: input.incidentId,
    kind: input.kind,
    actorUserId: input.actorUserId,
    body: null,
    visibility: 'internal',
    metadata: input.metadata,
    createdAt: input.now,
  })
  input.em.persist(entry)
  return entry
}

function impactTargetKey(impact: IncidentImpact): string {
  return `${impact.targetType}:${impact.targetId ?? impact.componentLabel ?? ''}`
}

async function emitLinkSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  link: IncidentLink,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: link,
    identifiers: {
      id: link.id,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    },
    indexer: linkIndexer,
  })
}

async function emitActionItemSideEffects(
  ctx: CommandRuntimeContext,
  action: 'updated' | 'deleted',
  actionItem: IncidentActionItem,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: actionItem,
    identifiers: {
      id: actionItem.id,
      organizationId: actionItem.organizationId,
      tenantId: actionItem.tenantId,
    },
    indexer: actionItemIndexer,
  })
}

async function emitImpactSideEffects(
  ctx: CommandRuntimeContext,
  action: 'updated' | 'deleted',
  impact: IncidentImpact,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: impact,
    identifiers: {
      id: impact.id,
      organizationId: impact.organizationId,
      tenantId: impact.tenantId,
    },
    indexer: impactIndexer,
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

async function emitLinkEvent(
  ctx: CommandRuntimeContext,
  source: Incident,
  target: Incident,
  link: IncidentLink,
  actorUserId: string,
): Promise<void> {
  await emitIncidentsEvent(
    'incidents.incident.linked',
    {
      id: source.id,
      incidentId: source.id,
      linkedIncidentId: target.id,
      linkId: link.id,
      kind: link.kind,
      organizationId: source.organizationId,
      tenantId: source.tenantId,
      actorUserId,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    },
    { persistent: true },
  )
}

async function emitMergeEvent(
  ctx: CommandRuntimeContext,
  source: Incident,
  target: Incident,
  actorUserId: string,
): Promise<void> {
  await emitIncidentsEvent(
    'incidents.incident.merged',
    {
      id: source.id,
      sourceIncidentId: source.id,
      targetIncidentId: target.id,
      organizationId: source.organizationId,
      tenantId: source.tenantId,
      actorUserId,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    },
    { persistent: true },
  )
}

async function captureLinkAfter(result: LinkCommandResult, ctx: CommandRuntimeContext): Promise<LinkSnapshot | null> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  return loadLinkSnapshot(em, result.linkId, result)
}

async function buildLinkLog(
  snapshots: { before?: unknown; after?: unknown },
  result: LinkCommandResult,
  label: { key: string; fallback: string },
): Promise<CommandLogMetadata | null> {
  if (result.alreadyLinked) return { skipLog: true }
  const before = snapshots.before as LinkSnapshot | undefined
  const after = snapshots.after as LinkSnapshot | undefined
  if (!before && !after) return null
  if (before && after && snapshotsEqual(before, after)) return { skipLog: true }
  const snapshot = after ?? before
  if (!snapshot) return null
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(label.key, label.fallback),
    resourceKind: 'incidents.link',
    resourceId: snapshot.id,
    parentResourceKind: 'incidents.incident',
    parentResourceId: result.incidentId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotBefore: before,
    snapshotAfter: after,
    changes: after ? buildChanges(before ? { ...before } : null, { ...after }, LINK_CHANGE_KEYS) : null,
    payload: {
      undo: { before, after } satisfies LinkUndoPayload,
    },
  }
}

async function restoreLinkSnapshot(em: EntityManager, snapshot: LinkSnapshot): Promise<IncidentLink> {
  const link = await em.findOne(IncidentLink, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
  })
  if (!link) return createLinkFromSnapshot(em, snapshot)
  applyLinkSnapshot(link, snapshot)
  em.persist(link)
  return link
}

async function undoToSnapshot(
  ctx: CommandRuntimeContext,
  snapshot: LinkSnapshot | null | undefined,
  action: 'created' | 'updated' | 'deleted',
): Promise<void> {
  if (!snapshot) return
  const scope = { organizationId: snapshot.organizationId, tenantId: snapshot.tenantId }
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const source = await findOneWithDecryption(
    em,
    Incident,
    { id: snapshot.incidentId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  const target = await findOneWithDecryption(
    em,
    Incident,
    { id: snapshot.linkedIncidentId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  let link!: IncidentLink
  const now = new Date()
  await withAtomicFlush(em, [
    async () => {
      link = await restoreLinkSnapshot(em, snapshot)
      if (action === 'created') link.deletedAt = null
      if (source) {
        source.updatedAt = now
        em.persist(source)
      }
      if (target) {
        target.updatedAt = now
        em.persist(target)
      }
    },
  ], { transaction: true, label: 'incidents.link.undo' })
  await emitLinkSideEffects(ctx, action, link)
  if (source) await emitIncidentSideEffects(ctx, 'updated', source)
  if (target) await emitIncidentSideEffects(ctx, 'updated', target)
}

const linkIncidentCommand: CommandHandler<IncidentLinkCreateInput, LinkCommandResult> = {
  id: 'incidents.incident.link',
  async execute(rawInput, ctx) {
    const parsed = incidentLinkCreateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    if (parsed.id === parsed.linkedIncidentId) {
      throw new CrudHttpError(400, { error: '[internal] link_self' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const source = await loadIncidentForLink(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, source)
    assertIncidentNotMerged(source)
    const target = await findOneWithDecryption(
      em,
      Incident,
      { id: parsed.linkedIncidentId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!target) throw new CrudHttpError(404, { error: '[internal] linked_incident_not_found' })
    assertIncidentNotMerged(target)

    const existing = await em.findOne(IncidentLink, {
      ...scope,
      kind: parsed.kind,
      deletedAt: null,
      $or: [
        { incidentId: source.id, linkedIncidentId: target.id },
        { incidentId: target.id, linkedIncidentId: source.id },
      ],
    })
    if (existing) {
      return {
        linkId: existing.id,
        incidentId: source.id,
        linkedIncidentId: target.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        updatedAt: source.updatedAt,
        alreadyLinked: true,
      }
    }

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let link!: IncidentLink
    let sourceTimeline!: IncidentTimelineEntry
    let targetTimeline!: IncidentTimelineEntry
    await withAtomicFlush(em, [
      () => {
        link = em.create(IncidentLink, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          incidentId: source.id,
          linkedIncidentId: target.id,
          kind: parsed.kind,
          createdAt: now,
          deletedAt: null,
        })
        em.persist(link)
        source.updatedAt = now
        target.updatedAt = now
        em.persist(source)
        em.persist(target)
        sourceTimeline = appendTimelineEntry({
          em,
          scope,
          incidentId: source.id,
          kind: 'linked',
          actorUserId,
          metadata: { linkedIncidentId: target.id, linkedNumber: target.number, kind: parsed.kind },
          now,
        })
        targetTimeline = appendTimelineEntry({
          em,
          scope,
          incidentId: target.id,
          kind: 'linked',
          actorUserId,
          metadata: { linkedIncidentId: source.id, linkedNumber: source.number, kind: parsed.kind },
          now,
        })
      },
    ], { transaction: true, label: 'incidents.incident.link' })

    await emitLinkSideEffects(ctx, 'created', link)
    await emitTimelineEntrySideEffects(ctx, sourceTimeline)
    await emitTimelineEntrySideEffects(ctx, targetTimeline)
    await emitIncidentSideEffects(ctx, 'updated', source)
    await emitIncidentSideEffects(ctx, 'updated', target)
    await emitLinkEvent(ctx, source, target, link, actorUserId)
    return {
      linkId: link.id,
      incidentId: source.id,
      linkedIncidentId: target.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: source.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureLinkAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildLinkLog(snapshots, result, {
    key: 'incidents.audit.link.create',
    fallback: 'Link incidents',
  }),
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<LinkUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(IncidentLink, { id: after.id, ...scope })
    const source = await findOneWithDecryption(
      em,
      Incident,
      { id: after.incidentId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    const target = await findOneWithDecryption(
      em,
      Incident,
      { id: after.linkedIncidentId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!link) return
    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        link.deletedAt = now
        if (source) {
          source.updatedAt = now
          em.persist(source)
        }
        if (target) {
          target.updatedAt = now
          em.persist(target)
        }
      },
    ], { transaction: true, label: 'incidents.incident.link.undo' })
    await emitLinkSideEffects(ctx, 'deleted', link)
    if (source) await emitIncidentSideEffects(ctx, 'updated', source)
    if (target) await emitIncidentSideEffects(ctx, 'updated', target)
  },
}

const unlinkIncidentCommand: CommandHandler<IncidentLinkRemoveInput, LinkCommandResult> = {
  id: 'incidents.incident.unlink',
  async prepare(rawInput, ctx) {
    const parsed = incidentLinkRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadLinkSnapshot(em, parsed.lid, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = incidentLinkRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const source = await loadIncidentForLink(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, source)
    assertIncidentNotMerged(source)
    const link = await em.findOne(IncidentLink, {
      id: parsed.lid,
      ...scope,
      deletedAt: null,
    })
    if (!link || (link.incidentId !== source.id && link.linkedIncidentId !== source.id)) {
      throw new CrudHttpError(404, { error: '[internal] incident_link_not_found' })
    }
    const counterpartId = link.incidentId === source.id ? link.linkedIncidentId : link.incidentId
    const target = await loadIncidentForLink(em, counterpartId, scope)
    assertIncidentNotMerged(target)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let sourceTimeline!: IncidentTimelineEntry
    let targetTimeline!: IncidentTimelineEntry
    await withAtomicFlush(em, [
      () => {
        link.deletedAt = now
        source.updatedAt = now
        target.updatedAt = now
        em.persist(link)
        em.persist(source)
        em.persist(target)
        sourceTimeline = appendTimelineEntry({
          em,
          scope,
          incidentId: source.id,
          kind: 'unlinked',
          actorUserId,
          metadata: { linkedIncidentId: target.id, linkedNumber: target.number, kind: link.kind },
          now,
        })
        targetTimeline = appendTimelineEntry({
          em,
          scope,
          incidentId: target.id,
          kind: 'unlinked',
          actorUserId,
          metadata: { linkedIncidentId: source.id, linkedNumber: source.number, kind: link.kind },
          now,
        })
      },
    ], { transaction: true, label: 'incidents.incident.unlink' })

    await emitLinkSideEffects(ctx, 'deleted', link)
    await emitTimelineEntrySideEffects(ctx, sourceTimeline)
    await emitTimelineEntrySideEffects(ctx, targetTimeline)
    await emitIncidentSideEffects(ctx, 'updated', source)
    await emitIncidentSideEffects(ctx, 'updated', target)
    return {
      linkId: link.id,
      incidentId: source.id,
      linkedIncidentId: target.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: source.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureLinkAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildLinkLog(snapshots, result, {
    key: 'incidents.audit.link.delete',
    fallback: 'Unlink incidents',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<LinkUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'created')
  },
}

const mergeIncidentCommand: CommandHandler<IncidentMergeInput, MergeCommandResult> = {
  id: 'incidents.incident.merge',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = incidentMergeSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    if (parsed.id === parsed.targetIncidentId) mergeInvalid('[internal] merge_self')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const source = await loadIncidentForLink(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, source)
    assertIncidentNotMerged(source)
    const target = await loadTargetIncidentForMerge(em, parsed.targetIncidentId, scope)
    if (target.mergedIntoIncidentId) mergeInvalid('[internal] target_merged')
    if (target.status === 'closed') mergeInvalid('[internal] target_closed')

    const actionItems = await em.find(IncidentActionItem, {
      incidentId: source.id,
      ...scope,
      deletedAt: null,
    })
    const sourceImpacts = await em.find(IncidentImpact, {
      incidentId: source.id,
      ...scope,
      deletedAt: null,
    })
    const targetImpacts = await em.find(IncidentImpact, {
      incidentId: target.id,
      ...scope,
      deletedAt: null,
    })
    const targetImpactKeys = new Set(targetImpacts.map(impactTargetKey))

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    const movedImpacts: IncidentImpact[] = []
    const deletedImpacts: IncidentImpact[] = []
    let sourceTimeline!: IncidentTimelineEntry
    let targetTimeline!: IncidentTimelineEntry
    await withAtomicFlush(em, [
      async () => {
        const lockedById = new Map<string, Incident | null>()
        for (const incidentId of [source.id, target.id].sort((left, right) => left.localeCompare(right))) {
          lockedById.set(incidentId, await em.findOne(
            Incident,
            { id: incidentId, ...scope, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          ))
        }
        const lockedSource = lockedById.get(source.id) ?? null
        const lockedTarget = lockedById.get(target.id) ?? null
        if (!lockedSource || lockedSource.mergedIntoIncidentId || lockedSource.status === 'closed') {
          mergeInvalid('[internal] source_changed')
        }
        if (!lockedTarget || lockedTarget.mergedIntoIncidentId || lockedTarget.status === 'closed') {
          mergeInvalid('[internal] target_changed')
        }
      },
      () => {
        source.mergedIntoIncidentId = target.id
        applyIncidentCloseCascade(source, now)
        source.updatedAt = now
        target.updatedAt = now
        em.persist(source)
        em.persist(target)
      },
      () => {
        for (const actionItem of actionItems) {
          actionItem.incidentId = target.id
          actionItem.updatedAt = now
          em.persist(actionItem)
        }
      },
      () => {
        for (const impact of sourceImpacts) {
          const key = impactTargetKey(impact)
          if (targetImpactKeys.has(key)) {
            impact.deletedAt = now
            impact.updatedAt = now
            deletedImpacts.push(impact)
          } else {
            impact.incidentId = target.id
            impact.updatedAt = now
            movedImpacts.push(impact)
            targetImpactKeys.add(key)
          }
          em.persist(impact)
        }
      },
      () => recomputeIncidentRevenue(em, scope, target),
      () => {
        sourceTimeline = appendTimelineEntry({
          em,
          scope,
          incidentId: source.id,
          kind: 'merged_into',
          actorUserId,
          metadata: { targetIncidentId: target.id, targetNumber: target.number },
          now,
        })
        targetTimeline = appendTimelineEntry({
          em,
          scope,
          incidentId: target.id,
          kind: 'merged_from',
          actorUserId,
          metadata: { sourceIncidentId: source.id, sourceNumber: source.number },
          now,
        })
      },
    ], { transaction: true, label: 'incidents.incident.merge' })

    for (const actionItem of actionItems) {
      await emitActionItemSideEffects(ctx, 'updated', actionItem)
    }
    for (const impact of movedImpacts) {
      await emitImpactSideEffects(ctx, 'updated', impact)
    }
    for (const impact of deletedImpacts) {
      await emitImpactSideEffects(ctx, 'deleted', impact)
    }
    await emitTimelineEntrySideEffects(ctx, sourceTimeline)
    await emitTimelineEntrySideEffects(ctx, targetTimeline)
    await emitIncidentSideEffects(ctx, 'updated', source)
    await emitIncidentSideEffects(ctx, 'updated', target)
    await emitMergeEvent(ctx, source, target, actorUserId)
    return {
      incidentId: source.id,
      targetIncidentId: target.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: source.updatedAt,
    }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.incident.merge', 'Merge incidents'),
      resourceKind: 'incidents.incident',
      resourceId: result.incidentId,
      parentResourceKind: 'incidents.incident',
      parentResourceId: result.targetIncidentId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      context: {
        undoable: false,
      },
    }
  },
}

registerCommand(linkIncidentCommand)
registerCommand(unlinkIncidentCommand)
registerCommand(mergeIncidentCommand)
