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
import { Incident, IncidentActionItem } from '../data/entities'
import {
  actionItemCreateSchema,
  actionItemRemoveSchema,
  actionItemUpdateSchema,
  type ActionItemCreateInput,
  type ActionItemRemoveInput,
  type ActionItemUpdateInput,
} from '../data/collab-validators'
import { emitIncidentsEvent } from '../events'
import {
  emitIncidentSideEffects,
  resolveActorUserId,
  resolveCommandScope,
  type IncidentScope,
} from './incident'
import { assertIncidentNotMerged } from './actions'

type ActionItemCommandResult = {
  actionItemId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt: Date
}

type ActionItemSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  incidentId: string
  title: string
  description: string | null
  assigneeUserId: string | null
  status: string
  dueAt: string | null
  completedAt: string | null
  externalRef: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type ActionItemUndoPayload = UndoPayload<ActionItemSnapshot>

const ACTION_ITEM_CHANGE_KEYS = [
  'title',
  'description',
  'assigneeUserId',
  'status',
  'dueAt',
  'completedAt',
  'externalRef',
  'deletedAt',
] as const satisfies readonly string[]

const actionItemIndexer: CrudIndexerConfig<IncidentActionItem> = {
  entityType: E.incidents.incident_action_item,
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

function normalizeOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

function snapshotActionItem(actionItem: IncidentActionItem): ActionItemSnapshot {
  return {
    id: actionItem.id,
    organizationId: actionItem.organizationId,
    tenantId: actionItem.tenantId,
    incidentId: actionItem.incidentId,
    title: actionItem.title,
    description: actionItem.description ?? null,
    assigneeUserId: actionItem.assigneeUserId ?? null,
    status: actionItem.status,
    dueAt: optionalIso(actionItem.dueAt),
    completedAt: optionalIso(actionItem.completedAt),
    externalRef: actionItem.externalRef ?? null,
    createdAt: actionItem.createdAt.toISOString(),
    updatedAt: actionItem.updatedAt.toISOString(),
    deletedAt: optionalIso(actionItem.deletedAt),
  }
}

async function loadActionItemSnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<ActionItemSnapshot | null> {
  const actionItem = await em.findOne(IncidentActionItem, {
    id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return actionItem ? snapshotActionItem(actionItem) : null
}

function applyActionItemSnapshot(actionItem: IncidentActionItem, snapshot: ActionItemSnapshot): void {
  actionItem.organizationId = snapshot.organizationId
  actionItem.tenantId = snapshot.tenantId
  actionItem.incidentId = snapshot.incidentId
  actionItem.title = snapshot.title
  actionItem.description = snapshot.description
  actionItem.assigneeUserId = snapshot.assigneeUserId
  actionItem.status = snapshot.status
  actionItem.dueAt = parseOptionalDate(snapshot.dueAt)
  actionItem.completedAt = parseOptionalDate(snapshot.completedAt)
  actionItem.externalRef = snapshot.externalRef
  actionItem.createdAt = new Date(snapshot.createdAt)
  actionItem.updatedAt = new Date(snapshot.updatedAt)
  actionItem.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createActionItemFromSnapshot(
  em: EntityManager,
  snapshot: ActionItemSnapshot,
): IncidentActionItem {
  const actionItem = em.create(IncidentActionItem, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    incidentId: snapshot.incidentId,
    title: snapshot.title,
    description: snapshot.description,
    assigneeUserId: snapshot.assigneeUserId,
    status: snapshot.status,
    dueAt: parseOptionalDate(snapshot.dueAt),
    completedAt: parseOptionalDate(snapshot.completedAt),
    externalRef: snapshot.externalRef,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(actionItem)
  return actionItem
}

async function loadIncidentForActionItem(
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

async function loadActiveActionItem(
  em: EntityManager,
  id: string,
  incidentId: string,
  scope: IncidentScope,
): Promise<IncidentActionItem> {
  const actionItem = await em.findOne(IncidentActionItem, {
    id,
    incidentId,
    ...scope,
    deletedAt: null,
  })
  if (!actionItem) throw new CrudHttpError(404, { error: '[internal] action_item_not_found' })
  return actionItem
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

async function emitActionItemSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
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

async function emitActionItemEvent(
  eventId: 'incidents.action_item.created' | 'incidents.action_item.completed',
  ctx: CommandRuntimeContext,
  incident: Incident,
  actionItem: IncidentActionItem,
  actorUserId: string,
): Promise<void> {
  await emitIncidentsEvent(
    eventId,
    {
      id: actionItem.id,
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      actorUserId,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    },
    { persistent: true },
  )
}

async function captureActionItemAfter(
  result: ActionItemCommandResult,
  ctx: CommandRuntimeContext,
): Promise<ActionItemSnapshot | null> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  return loadActionItemSnapshot(em, result.actionItemId, result)
}

async function buildActionItemLog(
  snapshots: { before?: unknown; after?: unknown },
  result: ActionItemCommandResult,
  label: { key: string; fallback: string },
): Promise<CommandLogMetadata | null> {
  const before = snapshots.before as ActionItemSnapshot | undefined
  const after = snapshots.after as ActionItemSnapshot | undefined
  if (!before && !after) return null
  if (before && after && snapshotsEqual(before, after)) return { skipLog: true }
  const snapshot = after ?? before
  if (!snapshot) return null
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(label.key, label.fallback),
    resourceKind: 'incidents.action_item',
    resourceId: snapshot.id,
    parentResourceKind: 'incidents.incident',
    parentResourceId: result.incidentId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotBefore: before,
    snapshotAfter: after,
    changes: after ? buildChanges(before ? { ...before } : null, { ...after }, ACTION_ITEM_CHANGE_KEYS) : null,
    payload: {
      undo: { before, after } satisfies ActionItemUndoPayload,
    },
  }
}

async function restoreActionItemSnapshot(
  em: EntityManager,
  snapshot: ActionItemSnapshot,
): Promise<IncidentActionItem> {
  const actionItem = await em.findOne(IncidentActionItem, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
  })
  if (!actionItem) return createActionItemFromSnapshot(em, snapshot)
  applyActionItemSnapshot(actionItem, snapshot)
  em.persist(actionItem)
  return actionItem
}

async function undoToSnapshot(
  ctx: CommandRuntimeContext,
  snapshot: ActionItemSnapshot | null | undefined,
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
  let actionItem!: IncidentActionItem
  const now = new Date()
  await withAtomicFlush(em, [
    async () => {
      actionItem = await restoreActionItemSnapshot(em, snapshot)
      actionItem.updatedAt = now
      if (action === 'created') actionItem.deletedAt = null
      if (incident) {
        incident.updatedAt = now
        em.persist(incident)
      }
    },
  ], { transaction: true, label: 'incidents.action_item.undo' })
  await emitActionItemSideEffects(ctx, action, actionItem)
  if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
}

const createActionItemCommand: CommandHandler<ActionItemCreateInput, ActionItemCommandResult> = {
  id: 'incidents.action_item.create',
  async execute(rawInput, ctx) {
    const parsed = actionItemCreateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForActionItem(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let actionItem!: IncidentActionItem
    await withAtomicFlush(em, [
      () => {
        actionItem = em.create(IncidentActionItem, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          incidentId: incident.id,
          title: parsed.title,
          description: normalizeOptionalText(parsed.description),
          assigneeUserId: parsed.assigneeUserId ?? null,
          status: 'open',
          dueAt: normalizeOptionalDate(parsed.dueAt),
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(actionItem)
        incident.updatedAt = now
        em.persist(incident)
      },
    ], { transaction: true, label: 'incidents.action_item.create' })

    await emitActionItemSideEffects(ctx, 'created', actionItem)
    await emitActionItemEvent('incidents.action_item.created', ctx, incident, actionItem, actorUserId)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      actionItemId: actionItem.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureActionItemAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildActionItemLog(snapshots, result, {
    key: 'incidents.audit.action_item.create',
    fallback: 'Create incident action item',
  }),
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<ActionItemUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const actionItem = await em.findOne(IncidentActionItem, { id: after.id, ...scope })
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id: after.incidentId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!actionItem) return
    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        actionItem.deletedAt = now
        actionItem.updatedAt = now
        if (incident) {
          incident.updatedAt = now
          em.persist(incident)
        }
      },
    ], { transaction: true, label: 'incidents.action_item.create.undo' })
    await emitActionItemSideEffects(ctx, 'deleted', actionItem)
    if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
  },
}

const updateActionItemCommand: CommandHandler<ActionItemUpdateInput, ActionItemCommandResult> = {
  id: 'incidents.action_item.update',
  async prepare(rawInput, ctx) {
    const parsed = actionItemUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadActionItemSnapshot(em, parsed.aid, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = actionItemUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForActionItem(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    const actionItem = await loadActiveActionItem(em, parsed.aid, incident.id, scope)

    const previousStatus = actionItem.status
    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let completed = false
    await withAtomicFlush(em, [
      () => {
        if (parsed.title !== undefined) actionItem.title = parsed.title
        if (parsed.description !== undefined) actionItem.description = normalizeOptionalText(parsed.description)
        if (parsed.assigneeUserId !== undefined) actionItem.assigneeUserId = parsed.assigneeUserId ?? null
        if (parsed.dueAt !== undefined) actionItem.dueAt = normalizeOptionalDate(parsed.dueAt)
        if (parsed.status !== undefined) {
          actionItem.status = parsed.status
          if (parsed.status === 'done' && previousStatus !== 'done') {
            actionItem.completedAt = now
            completed = true
          } else if (parsed.status !== 'done' && previousStatus === 'done') {
            actionItem.completedAt = null
          }
        }
        actionItem.updatedAt = now
        incident.updatedAt = now
        em.persist(actionItem)
        em.persist(incident)
      },
    ], { transaction: true, label: 'incidents.action_item.update' })

    await emitActionItemSideEffects(ctx, 'updated', actionItem)
    if (completed) {
      await emitActionItemEvent('incidents.action_item.completed', ctx, incident, actionItem, actorUserId)
    }
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      actionItemId: actionItem.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureActionItemAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildActionItemLog(snapshots, result, {
    key: 'incidents.audit.action_item.update',
    fallback: 'Update incident action item',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ActionItemUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'updated')
  },
}

const deleteActionItemCommand: CommandHandler<ActionItemRemoveInput, ActionItemCommandResult> = {
  id: 'incidents.action_item.delete',
  async prepare(rawInput, ctx) {
    const parsed = actionItemRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadActionItemSnapshot(em, parsed.aid, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = actionItemRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForActionItem(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    const actionItem = await loadActiveActionItem(em, parsed.aid, incident.id, scope)

    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        actionItem.deletedAt = now
        actionItem.updatedAt = now
        incident.updatedAt = now
        em.persist(actionItem)
        em.persist(incident)
      },
    ], { transaction: true, label: 'incidents.action_item.delete' })

    await emitActionItemSideEffects(ctx, 'deleted', actionItem)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      actionItemId: actionItem.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureActionItemAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildActionItemLog(snapshots, result, {
    key: 'incidents.audit.action_item.delete',
    fallback: 'Delete incident action item',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ActionItemUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'created')
  },
}

registerCommand(createActionItemCommand)
registerCommand(updateActionItemCommand)
registerCommand(deleteActionItemCommand)
