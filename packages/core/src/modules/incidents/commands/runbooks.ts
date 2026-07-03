import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import {
  Incident,
  IncidentActionItem,
  IncidentRunbook,
  IncidentRunbookStep,
  IncidentSeverity,
  IncidentTimelineEntry,
  IncidentType,
} from '../data/entities'
import {
  runbookCreateSchema,
  runbookInstantiateSchema,
  runbookStepCreateSchema,
  runbookStepUpdateSchema,
  runbookUpdateSchema,
  type IncidentRunbookCreateInput,
  type IncidentRunbookInstantiateInput,
  type IncidentRunbookStepCreateInput,
  type IncidentRunbookStepUpdateInput,
  type IncidentRunbookUpdateInput,
} from '../data/validators'
import { emitIncidentsEvent } from '../events'
import {
  emitIncidentSideEffects,
  resolveActorUserId,
  type IncidentScope,
} from './incident'
import { assertIncidentNotMerged } from './actions'

type ScopedInput = {
  organizationId?: string | null
  tenantId?: string | null
}

type ConfigDeleteInput = ScopedInput & {
  id?: string
}

type ConfigCommandResult = IncidentScope & {
  id: string
  updatedAt?: Date
}

type InstantiateRunbookResult = IncidentScope & {
  incidentId: string
  runbookId: string | null
  createdActionItemIds: string[]
  skippedActionItemIds: string[]
  updatedAt?: Date
}

type ActionItemDraft = {
  title: string
  description: string | null
  assigneeUserId: string | null
  dueAt: Date | null
  externalRef: string
}

const runbookIndexer: CrudIndexerConfig<IncidentRunbook> = { entityType: E.incidents.incident_runbook }
const runbookStepIndexer: CrudIndexerConfig<IncidentRunbookStep> = { entityType: E.incidents.incident_runbook_step }
const actionItemIndexer: CrudIndexerConfig<IncidentActionItem> = { entityType: E.incidents.incident_action_item }

function resolveCommandScope(ctx: CommandRuntimeContext, input: ScopedInput): IncidentScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization scope required' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function emitSideEffects<TEntity extends IncidentRunbook | IncidentRunbookStep | IncidentActionItem>(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  entity: TEntity,
  indexer: CrudIndexerConfig<TEntity>,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity,
    identifiers: {
      id: entity.id,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
    },
    indexer,
  })
}

async function ensureUniqueRunbookKey(
  em: EntityManager,
  scope: IncidentScope,
  key: string,
  excludeId?: string,
): Promise<void> {
  const existing = await em.findOne(IncidentRunbook, { ...scope, key, deletedAt: null })
  if (existing?.id && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Incident runbook key already exists for this scope' })
  }
}

async function requireRunbookInScope(
  em: EntityManager,
  scope: IncidentScope,
  runbookId: string,
): Promise<IncidentRunbook> {
  const runbook = await em.findOne(IncidentRunbook, { id: runbookId, ...scope, deletedAt: null })
  if (!runbook) throw new CrudHttpError(404, { error: '[internal] incident runbook not found' })
  return runbook
}

async function requireRunbookStepInScope(
  em: EntityManager,
  scope: IncidentScope,
  stepId: string,
): Promise<IncidentRunbookStep> {
  const step = await em.findOne(IncidentRunbookStep, { id: stepId, ...scope, deletedAt: null })
  if (!step) throw new CrudHttpError(404, { error: '[internal] incident runbook step not found' })
  return step
}

async function loadIncidentForRunbook(
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

async function resolveActiveRunbook(
  em: EntityManager,
  scope: IncidentScope,
  runbookId: string | null | undefined,
): Promise<IncidentRunbook | null> {
  if (!runbookId) return null
  return em.findOne(IncidentRunbook, {
    id: runbookId,
    ...scope,
    isActive: true,
    deletedAt: null,
  })
}

export async function resolveRunbookForIncident(
  em: EntityManager,
  scope: IncidentScope,
  incident: Pick<Incident, 'incidentTypeId' | 'severityId'>,
  explicitRunbookId?: string | null,
): Promise<IncidentRunbook | null> {
  const explicit = await resolveActiveRunbook(em, scope, explicitRunbookId)
  if (explicitRunbookId && !explicit) throw new CrudHttpError(404, { error: '[internal] incident runbook not found' })
  if (explicit) return explicit

  if (incident.incidentTypeId) {
    const type = await em.findOne(IncidentType, { id: incident.incidentTypeId, ...scope, deletedAt: null })
    const typeRunbook = await resolveActiveRunbook(em, scope, type?.defaultRunbookId ?? null)
    if (typeRunbook) return typeRunbook
  }

  const severity = await em.findOne(IncidentSeverity, { id: incident.severityId, ...scope, deletedAt: null })
  return resolveActiveRunbook(em, scope, severity?.defaultRunbookId ?? null)
}

export function buildRunbookActionItemDrafts(
  runbook: Pick<IncidentRunbook, 'id'>,
  steps: Array<Pick<IncidentRunbookStep, 'id' | 'title' | 'description' | 'assigneeUserId' | 'dueOffsetMinutes'>>,
  now: Date,
): ActionItemDraft[] {
  return steps.map((step) => ({
    title: step.title,
    description: normalizeOptionalText(step.description),
    assigneeUserId: step.assigneeUserId ?? null,
    dueAt: typeof step.dueOffsetMinutes === 'number'
      ? new Date(now.getTime() + step.dueOffsetMinutes * 60_000)
      : null,
    externalRef: `incident-runbook:${runbook.id}:step:${step.id}`,
  }))
}

const createRunbookCommand: CommandHandler<IncidentRunbookCreateInput, ConfigCommandResult> = {
  id: 'incidents.runbooks.create',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = runbookCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureUniqueRunbookKey(em, scope, parsed.key)
    const now = new Date()
    let runbook!: IncidentRunbook
    await withAtomicFlush(em, [() => {
      runbook = em.create(IncidentRunbook, {
        ...scope,
        key: parsed.key,
        name: parsed.name,
        description: normalizeOptionalText(parsed.description),
        isActive: parsed.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(runbook)
    }], { transaction: true, label: 'incidents.runbooks.create' })
    await emitSideEffects(ctx, 'created', runbook, runbookIndexer)
    return { id: runbook.id, ...scope, updatedAt: runbook.updatedAt }
  },
}

const updateRunbookCommand: CommandHandler<IncidentRunbookUpdateInput, ConfigCommandResult> = {
  id: 'incidents.runbooks.update',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = runbookUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const runbook = await requireRunbookInScope(em, scope, parsed.id)
    if (parsed.key !== undefined && parsed.key !== runbook.key) {
      await ensureUniqueRunbookKey(em, scope, parsed.key, runbook.id)
    }
    await withAtomicFlush(em, [() => {
      if (parsed.key !== undefined) runbook.key = parsed.key
      if (parsed.name !== undefined) runbook.name = parsed.name
      if (parsed.description !== undefined) runbook.description = normalizeOptionalText(parsed.description)
      if (parsed.isActive !== undefined) runbook.isActive = parsed.isActive
      runbook.updatedAt = new Date()
    }], { transaction: true, label: 'incidents.runbooks.update' })
    await emitSideEffects(ctx, 'updated', runbook, runbookIndexer)
    return { id: runbook.id, ...scope, updatedAt: runbook.updatedAt }
  },
}

const deleteRunbookCommand: CommandHandler<ConfigDeleteInput, ConfigCommandResult> = {
  id: 'incidents.runbooks.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Incident runbook id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const runbook = await requireRunbookInScope(em, scope, id)
    await withAtomicFlush(em, [() => {
      runbook.deletedAt = new Date()
      runbook.isActive = false
      runbook.updatedAt = new Date()
    }], { transaction: true, label: 'incidents.runbooks.delete' })
    await emitSideEffects(ctx, 'deleted', runbook, runbookIndexer)
    return { id: runbook.id, ...scope, updatedAt: runbook.updatedAt }
  },
}

const createRunbookStepCommand: CommandHandler<IncidentRunbookStepCreateInput, ConfigCommandResult> = {
  id: 'incidents.runbook_steps.create',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = runbookStepCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await requireRunbookInScope(em, scope, parsed.runbookId)
    const now = new Date()
    let step!: IncidentRunbookStep
    await withAtomicFlush(em, [() => {
      step = em.create(IncidentRunbookStep, {
        ...scope,
        runbookId: parsed.runbookId,
        position: parsed.position,
        title: parsed.title,
        description: normalizeOptionalText(parsed.description),
        assigneeUserId: parsed.assigneeUserId ?? null,
        dueOffsetMinutes: parsed.dueOffsetMinutes ?? null,
        isActive: parsed.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(step)
    }], { transaction: true, label: 'incidents.runbook_steps.create' })
    await emitSideEffects(ctx, 'created', step, runbookStepIndexer)
    return { id: step.id, ...scope, updatedAt: step.updatedAt }
  },
}

const updateRunbookStepCommand: CommandHandler<IncidentRunbookStepUpdateInput, ConfigCommandResult> = {
  id: 'incidents.runbook_steps.update',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = runbookStepUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const step = await requireRunbookStepInScope(em, scope, parsed.id)
    if (parsed.runbookId !== undefined) await requireRunbookInScope(em, scope, parsed.runbookId)
    await withAtomicFlush(em, [() => {
      if (parsed.runbookId !== undefined) step.runbookId = parsed.runbookId
      if (parsed.position !== undefined) step.position = parsed.position
      if (parsed.title !== undefined) step.title = parsed.title
      if (parsed.description !== undefined) step.description = normalizeOptionalText(parsed.description)
      if (parsed.assigneeUserId !== undefined) step.assigneeUserId = parsed.assigneeUserId ?? null
      if (parsed.dueOffsetMinutes !== undefined) step.dueOffsetMinutes = parsed.dueOffsetMinutes ?? null
      if (parsed.isActive !== undefined) step.isActive = parsed.isActive
      step.updatedAt = new Date()
    }], { transaction: true, label: 'incidents.runbook_steps.update' })
    await emitSideEffects(ctx, 'updated', step, runbookStepIndexer)
    return { id: step.id, ...scope, updatedAt: step.updatedAt }
  },
}

const deleteRunbookStepCommand: CommandHandler<ConfigDeleteInput, ConfigCommandResult> = {
  id: 'incidents.runbook_steps.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Incident runbook step id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const step = await requireRunbookStepInScope(em, scope, id)
    await withAtomicFlush(em, [() => {
      step.deletedAt = new Date()
      step.isActive = false
      step.updatedAt = new Date()
    }], { transaction: true, label: 'incidents.runbook_steps.delete' })
    await emitSideEffects(ctx, 'deleted', step, runbookStepIndexer)
    return { id: step.id, ...scope, updatedAt: step.updatedAt }
  },
}

const instantiateRunbookCommand: CommandHandler<IncidentRunbookInstantiateInput, InstantiateRunbookResult> = {
  id: 'incidents.runbook.instantiate',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = runbookInstantiateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForRunbook(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    const actorUserId = resolveActorUserId(ctx)
    const now = new Date()
    const runbook = await resolveRunbookForIncident(em, scope, incident, parsed.runbookId ?? null)
    if (!runbook) {
      return {
        incidentId: incident.id,
        runbookId: null,
        createdActionItemIds: [],
        skippedActionItemIds: [],
        ...scope,
        updatedAt: incident.updatedAt,
      }
    }

    const steps = await em.find(
      IncidentRunbookStep,
      { runbookId: runbook.id, ...scope, isActive: true, deletedAt: null },
      { orderBy: { position: 'asc' } },
    )
    const drafts = buildRunbookActionItemDrafts(runbook, steps, now)
    const existingItems = drafts.length > 0
      ? await em.find(IncidentActionItem, {
          incidentId: incident.id,
          ...scope,
          externalRef: { $in: drafts.map((draft) => draft.externalRef) },
          deletedAt: null,
        })
      : []
    const existingByExternalRef = new Map(existingItems.flatMap((item) =>
      item.externalRef ? [[item.externalRef, item]] : [],
    ))
    const createdActionItems: IncidentActionItem[] = []
    const skippedActionItemIds = existingItems.map((item) => item.id)

    await withAtomicFlush(em, [
      () => {
        for (const draft of drafts) {
          if (existingByExternalRef.has(draft.externalRef)) continue
          const actionItem = em.create(IncidentActionItem, {
            ...scope,
            incidentId: incident.id,
            title: draft.title,
            description: draft.description,
            assigneeUserId: draft.assigneeUserId,
            status: 'open',
            dueAt: draft.dueAt,
            completedAt: null,
            externalRef: draft.externalRef,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          em.persist(actionItem)
          createdActionItems.push(actionItem)
        }
        if (createdActionItems.length > 0) {
          const timelineEntry = em.create(IncidentTimelineEntry, {
            ...scope,
            incidentId: incident.id,
            kind: 'system',
            actorUserId,
            body: null,
            visibility: 'internal',
            metadata: {
              action: 'runbook_instantiated',
              runbookId: runbook.id,
              createdActionItemCount: createdActionItems.length,
            },
            createdAt: now,
          })
          em.persist(timelineEntry)
          incident.updatedAt = now
          em.persist(incident)
        }
      },
    ], { transaction: true, label: 'incidents.runbook.instantiate' })

    for (const actionItem of createdActionItems) {
      await emitSideEffects(ctx, 'created', actionItem, actionItemIndexer)
      await emitIncidentsEvent(
        'incidents.action_item.created',
        {
          id: actionItem.id,
          incidentId: incident.id,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          actorUserId,
          runbookId: runbook.id,
          ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
        },
        { persistent: true },
      )
    }
    if (createdActionItems.length > 0) await emitIncidentSideEffects(ctx, 'updated', incident)
    await emitIncidentsEvent(
      'incidents.runbook.instantiated',
      {
        id: runbook.id,
        incidentId: incident.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        actorUserId,
        createdActionItemIds: createdActionItems.map((item) => item.id),
        skippedActionItemIds,
      },
      { persistent: true },
    )

    return {
      incidentId: incident.id,
      runbookId: runbook.id,
      createdActionItemIds: createdActionItems.map((item) => item.id),
      skippedActionItemIds,
      ...scope,
      updatedAt: incident.updatedAt,
    }
  },
}

registerCommand(createRunbookCommand)
registerCommand(updateRunbookCommand)
registerCommand(deleteRunbookCommand)
registerCommand(createRunbookStepCommand)
registerCommand(updateRunbookStepCommand)
registerCommand(deleteRunbookStepCommand)
registerCommand(instantiateRunbookCommand)
