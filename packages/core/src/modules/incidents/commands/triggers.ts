import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
  snapshotsEqual,
} from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  IncidentEscalationPolicy,
  IncidentTrigger,
  type IncidentTriggerCondition,
} from '../data/entities'
import {
  triggerCreateSchema,
  triggerUpdateSchema,
  type IncidentTriggerCreateInput,
  type IncidentTriggerUpdateInput,
} from '../data/validators'

type IncidentScope = {
  organizationId: string
  tenantId: string
}

type ScopedInput = {
  organizationId?: string | null
  tenantId?: string | null
}

type TriggerDeleteInput = ScopedInput & {
  id?: string
}

type TriggerCommandResult = IncidentScope & {
  id: string
  updatedAt?: Date
}

type TriggerSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  eventId: string
  isEnabled: boolean
  severityKey: string | null
  typeKey: string | null
  escalationPolicyId: string | null
  conditions: IncidentTriggerCondition[] | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type TriggerUndoPayload = UndoPayload<TriggerSnapshot>

const INCIDENT_TRIGGER_ENTITY_ID = 'incidents:incident_trigger'

const triggerIndexer: CrudIndexerConfig<IncidentTrigger> = { entityType: INCIDENT_TRIGGER_ENTITY_ID }

const triggerEvents: CrudEventsConfig<IncidentTrigger> = {
  module: 'incidents',
  entity: 'trigger',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const TRIGGER_CHANGE_KEYS = [
  'eventId',
  'isEnabled',
  'severityKey',
  'typeKey',
  'escalationPolicyId',
  'conditions',
] as const

function optionalIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function parseOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function resolveCommandScope(ctx: CommandRuntimeContext, input: ScopedInput): IncidentScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: '[internal] Tenant scope required' })
  if (!organizationId) throw new CrudHttpError(400, { error: '[internal] Organization scope required' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

async function ensureUniqueTriggerEvent(
  em: EntityManager,
  scope: IncidentScope,
  eventId: string,
  excludeId?: string,
): Promise<void> {
  const existing = await em.findOne(IncidentTrigger, { ...scope, eventId, deletedAt: null })
  if (existing && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: '[internal] Incident trigger already exists for this event' })
  }
}

async function requireEscalationPolicyInScope(
  em: EntityManager,
  escalationPolicyId: string | null | undefined,
  scope: IncidentScope,
): Promise<void> {
  if (!escalationPolicyId) return
  const policy = await em.findOne(IncidentEscalationPolicy, {
    id: escalationPolicyId,
    ...scope,
    deletedAt: null,
  })
  if (!policy) throw new CrudHttpError(400, { error: '[internal] Incident escalation policy not found' })
}

async function emitTriggerSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  trigger: IncidentTrigger,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: trigger,
    identifiers: {
      id: trigger.id,
      organizationId: trigger.organizationId,
      tenantId: trigger.tenantId,
    },
    indexer: triggerIndexer,
    events: triggerEvents,
  })
}

async function emitTriggerUndoSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  trigger: IncidentTrigger | null | undefined,
  identifiers: IncidentScope & { id: string },
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: trigger,
    identifiers,
    indexer: triggerIndexer,
    events: triggerEvents,
  })
}

async function loadTriggerSnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<TriggerSnapshot | null> {
  const record = await em.findOne(IncidentTrigger, { id, ...scope })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    eventId: record.eventId,
    isEnabled: record.isEnabled,
    severityKey: record.severityKey ?? null,
    typeKey: record.typeKey ?? null,
    escalationPolicyId: record.escalationPolicyId ?? null,
    conditions: record.conditions ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: optionalIso(record.deletedAt),
  }
}

function applyTriggerSnapshot(record: IncidentTrigger, snapshot: TriggerSnapshot): void {
  record.eventId = snapshot.eventId
  record.isEnabled = snapshot.isEnabled
  record.severityKey = snapshot.severityKey
  record.typeKey = snapshot.typeKey
  record.escalationPolicyId = snapshot.escalationPolicyId
  record.conditions = snapshot.conditions
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createTriggerFromSnapshot(em: EntityManager, snapshot: TriggerSnapshot): IncidentTrigger {
  const record = em.create(IncidentTrigger, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    eventId: snapshot.eventId,
    isEnabled: snapshot.isEnabled,
    severityKey: snapshot.severityKey,
    typeKey: snapshot.typeKey,
    escalationPolicyId: snapshot.escalationPolicyId,
    conditions: snapshot.conditions,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(record)
  return record
}

const createTriggerCommand: CommandHandler<IncidentTriggerCreateInput, TriggerCommandResult> = {
  id: 'incidents.incident_triggers.create',
  async execute(input, ctx) {
    const parsed = triggerCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureUniqueTriggerEvent(em, scope, parsed.eventId)
    await requireEscalationPolicyInScope(em, parsed.escalationPolicyId, scope)
    const now = new Date()
    let record!: IncidentTrigger
    await withAtomicFlush(em, [
      () => {
        record = em.create(IncidentTrigger, {
          ...scope,
          eventId: parsed.eventId,
          isEnabled: parsed.isEnabled ?? true,
          severityKey: parsed.severityKey ?? null,
          typeKey: parsed.typeKey ?? null,
          escalationPolicyId: parsed.escalationPolicyId ?? null,
          conditions: parsed.conditions ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(record)
      },
    ], { transaction: true })
    await emitTriggerSideEffects(ctx, 'created', record)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadTriggerSnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as TriggerSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.triggers.create', 'Create incident trigger'),
      resourceKind: 'incidents.incident_trigger',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies TriggerUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<TriggerUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentTrigger, { id: after.id, ...scope })
    if (!record) return
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isEnabled = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitTriggerUndoSideEffects(ctx, 'deleted', record, { ...scope, id: record.id })
  },
  redo: makeCreateRedo<IncidentTrigger, TriggerSnapshot, IncidentTriggerCreateInput, TriggerCommandResult>({
    entityClass: IncidentTrigger,
    buildResult: (record) => ({ id: record.id, organizationId: record.organizationId, tenantId: record.tenantId, updatedAt: record.updatedAt }),
    events: triggerEvents,
    indexer: triggerIndexer,
    transaction: true,
  }),
}

const updateTriggerCommand: CommandHandler<IncidentTriggerUpdateInput, TriggerCommandResult> = {
  id: 'incidents.incident_triggers.update',
  async prepare(input, ctx) {
    const parsed = triggerUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadTriggerSnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const parsed = triggerUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentTrigger, { id: parsed.id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: '[internal] Incident trigger not found' })
    if (parsed.eventId !== undefined && parsed.eventId !== record.eventId) {
      await ensureUniqueTriggerEvent(em, scope, parsed.eventId, record.id)
    }
    if (parsed.escalationPolicyId !== undefined) {
      await requireEscalationPolicyInScope(em, parsed.escalationPolicyId, scope)
    }
    await withAtomicFlush(em, [() => {
      if (parsed.eventId !== undefined) record.eventId = parsed.eventId
      if (parsed.isEnabled !== undefined) record.isEnabled = parsed.isEnabled
      if (parsed.severityKey !== undefined) record.severityKey = parsed.severityKey ?? null
      if (parsed.typeKey !== undefined) record.typeKey = parsed.typeKey ?? null
      if (parsed.escalationPolicyId !== undefined) record.escalationPolicyId = parsed.escalationPolicyId ?? null
      if (parsed.conditions !== undefined) record.conditions = parsed.conditions ?? null
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitTriggerSideEffects(ctx, 'updated', record)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadTriggerSnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TriggerSnapshot | undefined
    const after = snapshots.after as TriggerSnapshot | undefined
    if (!before || !after) return null
    if (snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.triggers.update', 'Update incident trigger'),
      resourceKind: 'incidents.incident_trigger',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges({ ...before }, { ...after }, TRIGGER_CHANGE_KEYS),
      payload: { undo: { before, after } satisfies TriggerUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TriggerUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentTrigger, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createTriggerFromSnapshot(em, before)
        return
      }
      applyTriggerSnapshot(record, before)
    }], { transaction: true })
    await emitTriggerUndoSideEffects(ctx, 'updated', record, { ...scope, id: before.id })
  },
}

const deleteTriggerCommand: CommandHandler<TriggerDeleteInput, TriggerCommandResult> = {
  id: 'incidents.incident_triggers.delete',
  async prepare(input, ctx) {
    const id = requireId(input, '[internal] Incident trigger id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadTriggerSnapshot(em, id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, '[internal] Incident trigger id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentTrigger, { id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: '[internal] Incident trigger not found' })
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isEnabled = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitTriggerSideEffects(ctx, 'deleted', record)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TriggerSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.triggers.delete', 'Delete incident trigger'),
      resourceKind: 'incidents.incident_trigger',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies TriggerUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TriggerUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentTrigger, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createTriggerFromSnapshot(em, before)
        record.deletedAt = null
        return
      }
      applyTriggerSnapshot(record, before)
      record.deletedAt = null
    }], { transaction: true })
    await emitTriggerUndoSideEffects(ctx, 'created', record, { ...scope, id: before.id })
  },
}

registerCommand(createTriggerCommand)
registerCommand(updateTriggerCommand)
registerCommand(deleteTriggerCommand)
