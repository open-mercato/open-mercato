import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, runCrudCommandWrite } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { emitReferenceModuleEvent } from '../events'
import { ReferenceTask, ReferenceTaskLink, ReferenceTaskUndoSnapshot } from '../data/entities'
import { REFERENCE_TASK_ENTITY_ID } from '../data/entity-id'
import {
  referenceTaskCreateSchema,
  referenceTaskLinkCreateSchema,
  referenceTaskUndoPayloadSchema,
  referenceTaskUpdateSchema,
  type ReferenceScope,
  type ReferenceTaskUndoPayload,
} from '../data/validators'

const updateCommandSchema = z.object({ id: z.string().uuid(), updatedAt: z.string().datetime().optional() })
  .and(referenceTaskUpdateSchema)
const idCommandSchema = z.object({ id: z.string().uuid(), updatedAt: z.string().datetime().optional() })
const linkCreateCommandSchema = z.object({ taskId: z.string().uuid(), updatedAt: z.string().datetime().optional() })
  .and(referenceTaskLinkCreateSchema)
const linkDeleteCommandSchema = z.object({ taskId: z.string().uuid(), linkId: z.string().uuid(), updatedAt: z.string().datetime().optional() })

type TaskCommandResult = { id: string; updatedAt: string; undoSnapshotId: string }
type LinkCommandResult = TaskCommandResult & { linkId: string; linkUpdatedAt: string }
type UndoPointer = { snapshotId: string }

type TaskSnapshot = {
  title: string
  description: string | null
  status: ReferenceTask['status']
  priority: number
  dueAt: string | null
  isActive: boolean
  deletedAt: string | null
}

type LinkSnapshot = {
  id: string
  targetKind: ReferenceTaskLink['targetKind']
  targetId: string
  targetLabelSnapshot: string | null
  deletedAt: string | null
}

const taskCrudEvents: CrudEventsConfig<ReferenceTask> = {
  module: 'reference_module',
  entity: 'reference_task',
  persistent: true,
  buildPayload: ({ entity, identifiers }) => ({
    id: identifiers.id,
    tenantId: identifiers.tenantId,
    organizationId: identifiers.organizationId,
    status: entity.status,
    priority: entity.priority,
  }),
}

const taskCrudIndexer: CrudIndexerConfig<ReferenceTask> = {
  entityType: REFERENCE_TASK_ENTITY_ID,
  buildUpsertPayload: ({ entity, identifiers }) => ({
    entityType: REFERENCE_TASK_ENTITY_ID,
    recordId: identifiers.id,
    tenantId: identifiers.tenantId,
    organizationId: identifiers.organizationId,
    record: { id: entity.id, title: entity.title, status: entity.status },
  }),
}

function commandScope(ctx: CommandRuntimeContext): ReferenceScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(403, { error: 'A trusted tenant and organization scope is required' })
  }
  return { tenantId, organizationId }
}

function taskWhere(id: string, scope: ReferenceScope) {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId }
}

function taskIdentifiers(task: ReferenceTask) {
  return { id: task.id, tenantId: task.tenantId, organizationId: task.organizationId }
}

function snapshotTask(task: ReferenceTask): TaskSnapshot {
  return {
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    isActive: task.isActive,
    deletedAt: task.deletedAt?.toISOString() ?? null,
  }
}

function restoreTaskSnapshot(task: ReferenceTask, snapshot: TaskSnapshot): void {
  task.title = snapshot.title
  task.description = snapshot.description
  task.status = snapshot.status
  task.priority = snapshot.priority
  task.dueAt = snapshot.dueAt ? new Date(snapshot.dueAt) : null
  task.isActive = snapshot.isActive
  task.deletedAt = snapshot.deletedAt ? new Date(snapshot.deletedAt) : null
}

function snapshotLink(link: ReferenceTaskLink): LinkSnapshot {
  return {
    id: link.id,
    targetKind: link.targetKind,
    targetId: link.targetId,
    targetLabelSnapshot: link.targetLabelSnapshot ?? null,
    deletedAt: link.deletedAt?.toISOString() ?? null,
  }
}

function undoExpiry(now: Date): Date {
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
}

function persistUndoSnapshot(
  em: EntityManager,
  task: ReferenceTask,
  scope: ReferenceScope,
  operation: ReferenceTaskUndoPayload['operation'],
  values: Record<string, unknown>,
  expectedVersion: Date,
): ReferenceTaskUndoSnapshot {
  const now = new Date()
  const snapshot = em.create(ReferenceTaskUndoSnapshot, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    task,
    commandId: randomUUID(),
    commandType: `reference_module.reference_task.${operation}`,
    payload: JSON.stringify({ operation, values } satisfies ReferenceTaskUndoPayload),
    expectedVersion,
    createdAt: now,
    expiresAt: undoExpiry(now),
    consumedAt: null,
  })
  em.persist(snapshot)
  return snapshot
}

async function loadTask(em: EntityManager, id: string, scope: ReferenceScope): Promise<ReferenceTask> {
  const task = await findOneWithDecryption(em, ReferenceTask, taskWhere(id, scope), undefined, scope)
  if (!task) throw new CrudHttpError(404, { error: 'Reference task not found' })
  return task
}

async function enforceTaskVersion(
  ctx: CommandRuntimeContext,
  task: ReferenceTask,
  expected?: string,
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: 'reference_module.reference_task',
    resourceId: task.id,
    current: task.updatedAt,
    ...(expected ? { expected } : {}),
    request: ctx.request ?? null,
  })
}

async function resolveTargetSnapshot(
  ctx: CommandRuntimeContext,
  scope: ReferenceScope,
  targetKind: ReferenceTaskLink['targetKind'],
  targetId: string,
): Promise<string | null> {
  const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
  const targets = {
    customer: { entityId: 'customers:customer_entity', labelFields: ['display_name', 'title'] },
    catalog_product: { entityId: 'catalog:catalog_product', labelFields: ['title', 'sku'] },
    sales_document: { entityId: 'sales:sales_order', labelFields: ['document_number', 'number'] },
  } as const
  const target = targets[targetKind]
  try {
    const result = await queryEngine.query(target.entityId, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      filters: { id: { $eq: targetId } },
      fields: ['id', ...target.labelFields],
      page: { page: 1, pageSize: 1 },
    })
    const record = result.items[0] as Record<string, unknown> | undefined
    if (!record) throw new CrudHttpError(404, { error: 'Linked record not found' })
    for (const field of target.labelFields) {
      const value = record[field]
      if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    }
    return null
  } catch (error) {
    if (error instanceof CrudHttpError) throw error
    return null
  }
}

function logMetadata(snapshotId: string, taskId: string, scope: ReferenceScope, actionLabel: string) {
  return {
    actionLabel,
    resourceKind: 'reference_module.reference_task',
    resourceId: taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    payload: { undo: { snapshotId } satisfies UndoPointer },
  }
}

async function undoReferenceMutation(params: Parameters<NonNullable<CommandHandler['undo']>>[0]): Promise<void> {
  const pointer = extractUndoPayload<UndoPointer>(params.logEntry)
  if (!pointer?.snapshotId) throw new CrudHttpError(409, { error: 'Undo snapshot is unavailable' })
  const scope = commandScope(params.ctx)
  const em = (params.ctx.container.resolve('em') as EntityManager).fork()
  const undoSnapshot = await findOneWithDecryption(
    em,
    ReferenceTaskUndoSnapshot,
    { id: pointer.snapshotId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { populate: ['task'] },
    scope,
  )
  if (!undoSnapshot || undoSnapshot.consumedAt || undoSnapshot.expiresAt <= new Date()) {
    throw new CrudHttpError(409, { error: 'Undo snapshot is expired or already consumed' })
  }
  const task = await loadTask(em, undoSnapshot.task.id, scope)
  await enforceCommandOptimisticLockWithGuards(params.ctx.container, {
    resourceKind: 'reference_module.reference_task',
    resourceId: task.id,
    current: task.updatedAt,
    expected: undoSnapshot.expectedVersion,
    request: params.ctx.request ?? null,
  })
  const payload = referenceTaskUndoPayloadSchema.parse(JSON.parse(undoSnapshot.payload))
  let eventAction: 'created' | 'updated' | 'deleted' = 'updated'
  let lifecycleEvent: 'reference_module.reference_task.restored' | 'reference_module.reference_task.linked' | 'reference_module.reference_task.unlinked' | null = null
  const now = new Date()

  await withAtomicFlush(em, [async () => {
    if (payload.operation === 'create') {
      task.deletedAt = now
      eventAction = 'deleted'
    } else if (payload.operation === 'update' || payload.operation === 'delete' || payload.operation === 'restore') {
      restoreTaskSnapshot(task, payload.values.task as TaskSnapshot)
      if (payload.operation === 'delete') lifecycleEvent = 'reference_module.reference_task.restored'
      eventAction = task.deletedAt ? 'deleted' : 'updated'
    } else {
      const linkSnapshot = payload.values.link as LinkSnapshot
      let link = await findOneWithDecryption(
        em,
        ReferenceTaskLink,
        { id: linkSnapshot.id, task, tenantId: scope.tenantId, organizationId: scope.organizationId },
        undefined,
        scope,
      )
      if (!link) {
        link = em.create(ReferenceTaskLink, {
          id: linkSnapshot.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          task,
          targetKind: linkSnapshot.targetKind,
          targetId: linkSnapshot.targetId,
          targetLabelSnapshot: linkSnapshot.targetLabelSnapshot,
          deletedAt: null,
        })
        em.persist(link)
      }
      if (payload.operation === 'link_create') {
        link.deletedAt = now
        lifecycleEvent = 'reference_module.reference_task.unlinked'
      } else {
        link.deletedAt = linkSnapshot.deletedAt ? new Date(linkSnapshot.deletedAt) : null
        lifecycleEvent = 'reference_module.reference_task.linked'
      }
    }
    task.updatedAt = now
    undoSnapshot.consumedAt = now
  }], { transaction: true })

  const dataEngine = params.ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action: eventAction,
    entity: task,
    identifiers: taskIdentifiers(task),
    syncOrigin: params.ctx.syncOrigin,
    events: taskCrudEvents,
    indexer: taskCrudIndexer,
  })
  if (lifecycleEvent) {
    await emitReferenceModuleEvent(lifecycleEvent, {
      id: task.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }
}

const createTaskCommand: CommandHandler<unknown, TaskCommandResult> = {
  id: 'reference_module.reference_task.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = referenceTaskCreateSchema.parse(rawInput)
    const scope = commandScope(ctx)
    const now = new Date()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = em.create(ReferenceTask, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    let undoSnapshot!: ReferenceTaskUndoSnapshot
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: REFERENCE_TASK_ENTITY_ID,
      action: 'created',
      scope,
      phases: [async () => {
        em.persist(task)
        undoSnapshot = persistUndoSnapshot(em, task, scope, 'create', {}, task.updatedAt)
      }],
      customFields: input.customFields,
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
      sideEffect: () => ({ entity: task, identifiers: taskIdentifiers(task) }),
    })
    return { id: task.id, updatedAt: task.updatedAt.toISOString(), undoSnapshotId: undoSnapshot.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return logMetadata(result.undoSnapshotId, result.id, commandScope(ctx), translate('reference_module.audit.task.create', 'Create reference task'))
  },
  undo: undoReferenceMutation,
}

const updateTaskCommand: CommandHandler<unknown, TaskCommandResult> = {
  id: 'reference_module.reference_task.update',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = updateCommandSchema.parse(rawInput)
    const scope = commandScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await loadTask(em, input.id, scope)
    if (task.deletedAt) throw new CrudHttpError(404, { error: 'Reference task not found' })
    await enforceTaskVersion(ctx, task, input.updatedAt)
    const before = snapshotTask(task)
    if (input.title !== undefined) task.title = input.title
    if (input.description !== undefined) task.description = input.description
    if (input.status !== undefined) task.status = input.status
    if (input.priority !== undefined) task.priority = input.priority
    if (input.dueAt !== undefined) task.dueAt = input.dueAt ? new Date(input.dueAt) : null
    if (input.isActive !== undefined) task.isActive = input.isActive
    task.updatedAt = new Date()
    let undoSnapshot!: ReferenceTaskUndoSnapshot
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: REFERENCE_TASK_ENTITY_ID,
      action: 'updated',
      scope,
      phases: [async () => {
        undoSnapshot = persistUndoSnapshot(em, task, scope, 'update', { task: before }, task.updatedAt)
      }],
      customFields: input.customFields,
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
      sideEffect: () => ({ entity: task, identifiers: taskIdentifiers(task) }),
    })
    return { id: task.id, updatedAt: task.updatedAt.toISOString(), undoSnapshotId: undoSnapshot.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return logMetadata(result.undoSnapshotId, result.id, commandScope(ctx), translate('reference_module.audit.task.update', 'Update reference task'))
  },
  undo: undoReferenceMutation,
}

const deleteTaskCommand: CommandHandler<unknown, TaskCommandResult> = {
  id: 'reference_module.reference_task.delete',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = idCommandSchema.parse(rawInput)
    const scope = commandScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await loadTask(em, input.id, scope)
    if (task.deletedAt) throw new CrudHttpError(404, { error: 'Reference task not found' })
    await enforceTaskVersion(ctx, task, input.updatedAt)
    const before = snapshotTask(task)
    task.deletedAt = new Date()
    task.updatedAt = new Date()
    let undoSnapshot!: ReferenceTaskUndoSnapshot
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: REFERENCE_TASK_ENTITY_ID,
      action: 'deleted',
      scope,
      phases: [async () => {
        undoSnapshot = persistUndoSnapshot(em, task, scope, 'delete', { task: before }, task.updatedAt)
      }],
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
      sideEffect: () => ({ entity: task, identifiers: taskIdentifiers(task) }),
    })
    return { id: task.id, updatedAt: task.updatedAt.toISOString(), undoSnapshotId: undoSnapshot.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return logMetadata(result.undoSnapshotId, result.id, commandScope(ctx), translate('reference_module.audit.task.delete', 'Delete reference task'))
  },
  undo: undoReferenceMutation,
}

const restoreTaskCommand: CommandHandler<unknown, TaskCommandResult> = {
  id: 'reference_module.reference_task.restore',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = idCommandSchema.parse(rawInput)
    const scope = commandScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await loadTask(em, input.id, scope)
    if (!task.deletedAt) throw new CrudHttpError(409, { error: 'Reference task is not deleted' })
    await enforceTaskVersion(ctx, task, input.updatedAt)
    const before = snapshotTask(task)
    task.deletedAt = null
    task.updatedAt = new Date()
    let undoSnapshot!: ReferenceTaskUndoSnapshot
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: REFERENCE_TASK_ENTITY_ID,
      action: 'updated',
      scope,
      phases: [async () => {
        undoSnapshot = persistUndoSnapshot(em, task, scope, 'restore', { task: before }, task.updatedAt)
      }],
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
      sideEffect: () => ({ entity: task, identifiers: taskIdentifiers(task) }),
    })
    await emitReferenceModuleEvent('reference_module.reference_task.restored', { id: task.id, ...scope })
    return { id: task.id, updatedAt: task.updatedAt.toISOString(), undoSnapshotId: undoSnapshot.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return logMetadata(result.undoSnapshotId, result.id, commandScope(ctx), translate('reference_module.audit.task.restore', 'Restore reference task'))
  },
  undo: undoReferenceMutation,
}

const createLinkCommand: CommandHandler<unknown, LinkCommandResult> = {
  id: 'reference_module.reference_task.link.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = linkCreateCommandSchema.parse(rawInput)
    const scope = commandScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await loadTask(em, input.taskId, scope)
    if (task.deletedAt) throw new CrudHttpError(404, { error: 'Reference task not found' })
    await enforceTaskVersion(ctx, task, input.updatedAt)
    const existing = await findOneWithDecryption(
      em,
      ReferenceTaskLink,
      { task, targetKind: input.targetKind, targetId: input.targetId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      undefined,
      scope,
    )
    if (existing) throw new CrudHttpError(409, { error: 'Reference task link already exists' })
    const targetLabelSnapshot = await resolveTargetSnapshot(ctx, scope, input.targetKind, input.targetId)
    const now = new Date()
    const link = em.create(ReferenceTaskLink, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      task,
      targetKind: input.targetKind,
      targetId: input.targetId,
      targetLabelSnapshot,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    task.updatedAt = now
    let undoSnapshot!: ReferenceTaskUndoSnapshot
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: REFERENCE_TASK_ENTITY_ID,
      action: 'updated',
      scope,
      phases: [async () => {
        em.persist(link)
        undoSnapshot = persistUndoSnapshot(em, task, scope, 'link_create', { link: snapshotLink(link) }, task.updatedAt)
      }],
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
      sideEffect: () => ({ entity: task, identifiers: taskIdentifiers(task) }),
    })
    await emitReferenceModuleEvent('reference_module.reference_task.linked', {
      id: task.id,
      linkId: link.id,
      targetKind: link.targetKind,
      targetId: link.targetId,
      ...scope,
    })
    return {
      id: task.id,
      linkId: link.id,
      updatedAt: task.updatedAt.toISOString(),
      linkUpdatedAt: link.updatedAt.toISOString(),
      undoSnapshotId: undoSnapshot.id,
    }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return logMetadata(result.undoSnapshotId, result.id, commandScope(ctx), translate('reference_module.audit.link.create', 'Link reference task'))
  },
  undo: undoReferenceMutation,
}

const deleteLinkCommand: CommandHandler<unknown, LinkCommandResult> = {
  id: 'reference_module.reference_task.link.delete',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = linkDeleteCommandSchema.parse(rawInput)
    const scope = commandScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await loadTask(em, input.taskId, scope)
    if (task.deletedAt) throw new CrudHttpError(404, { error: 'Reference task not found' })
    const link = await findOneWithDecryption(
      em,
      ReferenceTaskLink,
      { id: input.linkId, task, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      undefined,
      scope,
    )
    if (!link) throw new CrudHttpError(404, { error: 'Reference task link not found' })
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: 'reference_module.reference_task_link',
      resourceId: link.id,
      current: link.updatedAt,
      ...(input.updatedAt ? { expected: input.updatedAt } : {}),
      request: ctx.request ?? null,
    })
    const before = snapshotLink(link)
    const now = new Date()
    link.deletedAt = now
    link.updatedAt = now
    task.updatedAt = now
    let undoSnapshot!: ReferenceTaskUndoSnapshot
    await runCrudCommandWrite({
      ctx,
      em,
      entityId: REFERENCE_TASK_ENTITY_ID,
      action: 'updated',
      scope,
      phases: [async () => {
        undoSnapshot = persistUndoSnapshot(em, task, scope, 'link_delete', { link: before }, task.updatedAt)
      }],
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
      sideEffect: () => ({ entity: task, identifiers: taskIdentifiers(task) }),
    })
    await emitReferenceModuleEvent('reference_module.reference_task.unlinked', {
      id: task.id,
      linkId: link.id,
      targetKind: link.targetKind,
      targetId: link.targetId,
      ...scope,
    })
    return {
      id: task.id,
      linkId: link.id,
      updatedAt: task.updatedAt.toISOString(),
      linkUpdatedAt: link.updatedAt.toISOString(),
      undoSnapshotId: undoSnapshot.id,
    }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return logMetadata(result.undoSnapshotId, result.id, commandScope(ctx), translate('reference_module.audit.link.delete', 'Unlink reference task'))
  },
  undo: undoReferenceMutation,
}

registerCommand(createTaskCommand)
registerCommand(updateTaskCommand)
registerCommand(deleteTaskCommand)
registerCommand(restoreTaskCommand)
registerCommand(createLinkCommand)
registerCommand(deleteLinkCommand)

export { taskCrudEvents, taskCrudIndexer }
