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
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { Incident, IncidentPostmortem, IncidentTimelineEntry } from '../data/entities'
import {
  postmortemPublishSchema,
  postmortemUpsertSchema,
  type PostmortemPublishInput,
  type PostmortemUpsertInput,
} from '../data/collab-validators'
import { emitIncidentsEvent } from '../events'
import {
  emitIncidentSideEffects,
  resolveActorUserId,
  resolveCommandScope,
  type IncidentScope,
} from './incident'
import { assertIncidentNotMerged } from './actions'

type PostmortemCommandResult = {
  postmortemId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt: Date
  publishedAt?: Date | null
}

type PostmortemSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  incidentId: string
  summary: string | null
  rootCause: string | null
  impact: string | null
  contributingFactors: string | null
  lessons: string | null
  status: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type PostmortemUndoPayload = UndoPayload<PostmortemSnapshot>

const POSTMORTEM_CHANGE_KEYS = [
  'summary',
  'rootCause',
  'impact',
  'contributingFactors',
  'lessons',
  'status',
  'publishedAt',
  'deletedAt',
] as const satisfies readonly string[]

const postmortemIndexer: CrudIndexerConfig<IncidentPostmortem> = {
  entityType: E.incidents.incident_postmortem,
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

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function snapshotPostmortem(postmortem: IncidentPostmortem): PostmortemSnapshot {
  return {
    id: postmortem.id,
    organizationId: postmortem.organizationId,
    tenantId: postmortem.tenantId,
    incidentId: postmortem.incidentId,
    summary: postmortem.summary ?? null,
    rootCause: postmortem.rootCause ?? null,
    impact: postmortem.impact ?? null,
    contributingFactors: postmortem.contributingFactors ?? null,
    lessons: postmortem.lessons ?? null,
    status: postmortem.status,
    publishedAt: optionalIso(postmortem.publishedAt),
    createdAt: postmortem.createdAt.toISOString(),
    updatedAt: postmortem.updatedAt.toISOString(),
    deletedAt: optionalIso(postmortem.deletedAt),
  }
}

async function loadPostmortemSnapshot(
  em: EntityManager,
  incidentId: string,
  scope: IncidentScope,
): Promise<PostmortemSnapshot | null> {
  const postmortem = await findOneWithDecryption(
    em,
    IncidentPostmortem,
    { incidentId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  return postmortem ? snapshotPostmortem(postmortem) : null
}

function applyPostmortemSnapshot(postmortem: IncidentPostmortem, snapshot: PostmortemSnapshot): void {
  postmortem.organizationId = snapshot.organizationId
  postmortem.tenantId = snapshot.tenantId
  postmortem.incidentId = snapshot.incidentId
  postmortem.summary = snapshot.summary
  postmortem.rootCause = snapshot.rootCause
  postmortem.impact = snapshot.impact
  postmortem.contributingFactors = snapshot.contributingFactors
  postmortem.lessons = snapshot.lessons
  postmortem.status = snapshot.status
  postmortem.publishedAt = parseOptionalDate(snapshot.publishedAt)
  postmortem.createdAt = new Date(snapshot.createdAt)
  postmortem.updatedAt = new Date(snapshot.updatedAt)
  postmortem.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createPostmortemFromSnapshot(
  em: EntityManager,
  snapshot: PostmortemSnapshot,
): IncidentPostmortem {
  const postmortem = em.create(IncidentPostmortem, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    incidentId: snapshot.incidentId,
    summary: snapshot.summary,
    rootCause: snapshot.rootCause,
    impact: snapshot.impact,
    contributingFactors: snapshot.contributingFactors,
    lessons: snapshot.lessons,
    status: snapshot.status,
    publishedAt: parseOptionalDate(snapshot.publishedAt),
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(postmortem)
  return postmortem
}

async function loadIncidentForPostmortem(
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

function applyPostmortemFields(postmortem: IncidentPostmortem, parsed: PostmortemUpsertInput): void {
  if (parsed.summary !== undefined) postmortem.summary = normalizeOptionalText(parsed.summary)
  if (parsed.rootCause !== undefined) postmortem.rootCause = normalizeOptionalText(parsed.rootCause)
  if (parsed.impact !== undefined) postmortem.impact = normalizeOptionalText(parsed.impact)
  if (parsed.contributingFactors !== undefined) {
    postmortem.contributingFactors = normalizeOptionalText(parsed.contributingFactors)
  }
  if (parsed.lessons !== undefined) postmortem.lessons = normalizeOptionalText(parsed.lessons)
}

function createTimelineEntry(input: {
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

async function emitPostmortemSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  postmortem: IncidentPostmortem,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: postmortem,
    identifiers: {
      id: postmortem.id,
      organizationId: postmortem.organizationId,
      tenantId: postmortem.tenantId,
    },
    indexer: postmortemIndexer,
  })
}

async function emitTimelineEntrySideEffects(
  ctx: CommandRuntimeContext,
  entry: IncidentTimelineEntry | null,
): Promise<void> {
  if (!entry) return
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

async function emitPostmortemEvent(
  eventId: 'incidents.postmortem.created' | 'incidents.postmortem.published',
  ctx: CommandRuntimeContext,
  incident: Incident,
  postmortem: IncidentPostmortem,
  actorUserId: string,
): Promise<void> {
  await emitIncidentsEvent(
    eventId,
    {
      id: postmortem.id,
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      actorUserId,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    },
    { persistent: true },
  )
}

async function capturePostmortemAfter(
  result: PostmortemCommandResult,
  ctx: CommandRuntimeContext,
): Promise<PostmortemSnapshot | null> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  return loadPostmortemSnapshot(em, result.incidentId, result)
}

async function buildPostmortemLog(
  snapshots: { before?: unknown; after?: unknown },
  result: PostmortemCommandResult,
  label: { key: string; fallback: string },
): Promise<CommandLogMetadata | null> {
  const before = snapshots.before as PostmortemSnapshot | undefined
  const after = snapshots.after as PostmortemSnapshot | undefined
  if (!before && !after) return null
  if (before && after && snapshotsEqual(before, after)) return { skipLog: true }
  const snapshot = after ?? before
  if (!snapshot) return null
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(label.key, label.fallback),
    resourceKind: 'incidents.postmortem',
    resourceId: snapshot.id,
    parentResourceKind: 'incidents.incident',
    parentResourceId: result.incidentId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotBefore: before,
    snapshotAfter: after,
    changes: after ? buildChanges(before ? { ...before } : null, { ...after }, POSTMORTEM_CHANGE_KEYS) : null,
    payload: {
      undo: { before, after } satisfies PostmortemUndoPayload,
    },
  }
}

async function undoToSnapshot(
  ctx: CommandRuntimeContext,
  snapshot: PostmortemSnapshot | null | undefined,
  action: 'created' | 'updated' | 'deleted',
): Promise<void> {
  if (!snapshot) return
  const scope = { organizationId: snapshot.organizationId, tenantId: snapshot.tenantId }
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const incident = await findOneWithDecryption(
    em,
    Incident,
    { id: snapshot.incidentId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  let postmortem!: IncidentPostmortem
  const now = new Date()
  await withAtomicFlush(em, [
    async () => {
      const existing = await findOneWithDecryption(
        em,
        IncidentPostmortem,
        { id: snapshot.id, ...scope },
        undefined,
        scope,
      )
      postmortem = existing ?? createPostmortemFromSnapshot(em, snapshot)
      applyPostmortemSnapshot(postmortem, snapshot)
      postmortem.updatedAt = now
      if (action === 'created') postmortem.deletedAt = null
      if (incident) {
        incident.updatedAt = now
        em.persist(incident)
      }
    },
  ], { transaction: true, label: 'incidents.postmortem.undo' })
  await emitPostmortemSideEffects(ctx, action, postmortem)
  if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
}

const upsertPostmortemCommand: CommandHandler<PostmortemUpsertInput, PostmortemCommandResult> = {
  id: 'incidents.postmortem.upsert',
  async prepare(rawInput, ctx) {
    const parsed = postmortemUpsertSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadPostmortemSnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = postmortemUpsertSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForPostmortem(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)

    let postmortem = await findOneWithDecryption(
      em,
      IncidentPostmortem,
      { incidentId: incident.id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (postmortem?.status === 'published') {
      throw new CrudHttpError(409, { error: '[internal] postmortem_published' })
    }

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    const isCreate = !postmortem
    let timelineEntry: IncidentTimelineEntry | null = null
    await withAtomicFlush(em, [
      () => {
        if (!postmortem) {
          postmortem = em.create(IncidentPostmortem, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            incidentId: incident.id,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          em.persist(postmortem)
          timelineEntry = createTimelineEntry({
            em,
            scope,
            incidentId: incident.id,
            kind: 'postmortem_updated',
            actorUserId,
            metadata: { postmortemId: postmortem.id },
            now,
          })
        }
        applyPostmortemFields(postmortem, parsed)
        postmortem.updatedAt = now
        incident.updatedAt = now
        em.persist(postmortem)
        em.persist(incident)
      },
    ], { transaction: true, label: 'incidents.postmortem.upsert' })

    const savedPostmortem = postmortem
    if (!savedPostmortem) throw new CrudHttpError(500, { error: '[internal] postmortem_upsert_failed' })

    await emitPostmortemSideEffects(ctx, isCreate ? 'created' : 'updated', savedPostmortem)
    if (isCreate) {
      await emitPostmortemEvent('incidents.postmortem.created', ctx, incident, savedPostmortem, actorUserId)
    }
    await emitTimelineEntrySideEffects(ctx, timelineEntry)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      postmortemId: savedPostmortem.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => capturePostmortemAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildPostmortemLog(snapshots, result, {
    key: 'incidents.audit.postmortem.upsert',
    fallback: 'Upsert incident postmortem',
  }),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PostmortemUndoPayload>(logEntry)
    if (payload?.before) {
      await undoToSnapshot(ctx, payload.before, 'updated')
      return
    }
    const after = payload?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const postmortem = await findOneWithDecryption(
      em,
      IncidentPostmortem,
      { id: after.id, ...scope },
      undefined,
      scope,
    )
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id: after.incidentId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!postmortem) return
    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        postmortem.deletedAt = now
        postmortem.updatedAt = now
        if (incident) {
          incident.updatedAt = now
          em.persist(incident)
        }
      },
    ], { transaction: true, label: 'incidents.postmortem.upsert.undo' })
    await emitPostmortemSideEffects(ctx, 'deleted', postmortem)
    if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
  },
}

const publishPostmortemCommand: CommandHandler<PostmortemPublishInput, PostmortemCommandResult> = {
  id: 'incidents.postmortem.publish',
  async prepare(rawInput, ctx) {
    const parsed = postmortemPublishSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadPostmortemSnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = postmortemPublishSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForPostmortem(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)

    const postmortem = await findOneWithDecryption(
      em,
      IncidentPostmortem,
      { incidentId: incident.id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!postmortem) throw new CrudHttpError(409, { error: '[internal] postmortem_missing' })
    if (postmortem.status === 'published') {
      throw new CrudHttpError(409, { error: '[internal] postmortem_published' })
    }

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let timelineEntry: IncidentTimelineEntry | null = null
    await withAtomicFlush(em, [
      () => {
        postmortem.status = 'published'
        postmortem.publishedAt = now
        postmortem.updatedAt = now
        incident.updatedAt = now
        timelineEntry = createTimelineEntry({
          em,
          scope,
          incidentId: incident.id,
          kind: 'postmortem_published',
          actorUserId,
          metadata: { postmortemId: postmortem.id, publishedAt: now.toISOString() },
          now,
        })
        em.persist(postmortem)
        em.persist(incident)
      },
    ], { transaction: true, label: 'incidents.postmortem.publish' })

    await emitPostmortemSideEffects(ctx, 'updated', postmortem)
    await emitPostmortemEvent('incidents.postmortem.published', ctx, incident, postmortem, actorUserId)
    await emitTimelineEntrySideEffects(ctx, timelineEntry)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      postmortemId: postmortem.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
      publishedAt: postmortem.publishedAt ?? null,
    }
  },
  captureAfter: (_input, result, ctx) => capturePostmortemAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildPostmortemLog(snapshots, result, {
    key: 'incidents.audit.postmortem.publish',
    fallback: 'Publish incident postmortem',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<PostmortemUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'updated')
  },
}

registerCommand(upsertPostmortemCommand)
registerCommand(publishPostmortemCommand)
