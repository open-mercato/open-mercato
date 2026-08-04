import { incidentFindOne } from '../lib/read'
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
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import {
  IncidentEscalationPolicy,
  type IncidentEscalationStep,
} from '../data/entities'
import {
  escalationPolicyCreateSchema,
  escalationPolicyUpdateSchema,
  type IncidentEscalationPolicyCreateInput,
  type IncidentEscalationPolicyUpdateInput,
} from '../data/validators'

type IncidentScope = {
  organizationId: string
  tenantId: string
}

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

type IndexedEntity = IncidentScope & {
  id: string
}

type EscalationPolicySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  key: string
  name: string
  steps: IncidentEscalationStep[]
  repeatCount: number
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type EscalationPolicyUndoPayload = UndoPayload<EscalationPolicySnapshot>

const escalationPolicyIndexer: CrudIndexerConfig<IncidentEscalationPolicy> = {
  entityType: E.incidents.incident_escalation_policy,
}

const ESCALATION_POLICY_CHANGE_KEYS = ['key', 'name', 'steps', 'repeatCount', 'isDefault', 'isActive'] as const

function optionalIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function parseOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function resolveCommandScope(ctx: CommandRuntimeContext, input: ScopedInput): IncidentScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization scope required' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

function assertUniqueConfigKey(existingId: string | null, excludeId?: string): void {
  if (existingId && existingId !== excludeId) {
    throw new CrudHttpError(409, { error: 'Incident config key already exists for this scope' })
  }
}

async function ensureUniqueEscalationPolicyKey(
  em: EntityManager,
  scope: IncidentScope,
  key: string,
  excludeId?: string,
): Promise<void> {
  const existing = await incidentFindOne(em, IncidentEscalationPolicy, { ...scope, key, deletedAt: null })
  assertUniqueConfigKey(existing?.id ?? null, excludeId)
}

async function emitConfigSideEffects<TEntity extends IndexedEntity>(
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

async function emitConfigUndoSideEffects<TEntity extends IndexedEntity>(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  entity: TEntity | null | undefined,
  identifiers: IncidentScope & { id: string },
  indexer: CrudIndexerConfig<TEntity>,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity,
    identifiers,
    indexer,
  })
}

async function loadEscalationPolicySnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<EscalationPolicySnapshot | null> {
  const record = await incidentFindOne(em, IncidentEscalationPolicy, { id, organizationId: scope.organizationId, tenantId: scope.tenantId })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    key: record.key,
    name: record.name,
    steps: record.steps,
    repeatCount: record.repeatCount,
    isDefault: record.isDefault,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: optionalIso(record.deletedAt),
  }
}

function applyEscalationPolicySnapshot(
  record: IncidentEscalationPolicy,
  snapshot: EscalationPolicySnapshot,
): void {
  record.key = snapshot.key
  record.name = snapshot.name
  record.steps = snapshot.steps
  record.repeatCount = snapshot.repeatCount
  record.isDefault = snapshot.isDefault
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createEscalationPolicyFromSnapshot(
  em: EntityManager,
  snapshot: EscalationPolicySnapshot,
): IncidentEscalationPolicy {
  const record = em.create(IncidentEscalationPolicy, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    key: snapshot.key,
    name: snapshot.name,
    steps: snapshot.steps,
    repeatCount: snapshot.repeatCount,
    isDefault: snapshot.isDefault,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(record)
  return record
}

const createEscalationPolicyCommand: CommandHandler<IncidentEscalationPolicyCreateInput, ConfigCommandResult> = {
  id: 'incidents.escalation_policy.create',
  async execute(input, ctx) {
    const parsed = escalationPolicyCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureUniqueEscalationPolicyKey(em, scope, parsed.key)
    const now = new Date()
    let record!: IncidentEscalationPolicy
    await withAtomicFlush(em, [
      () => {
        record = em.create(IncidentEscalationPolicy, {
          ...scope,
          key: parsed.key,
          name: parsed.name,
          steps: parsed.steps,
          repeatCount: parsed.repeatCount ?? 0,
          isDefault: parsed.isDefault ?? false,
          isActive: parsed.isActive ?? true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(record)
      },
    ], { transaction: true })
    await emitConfigSideEffects(ctx, 'created', record, escalationPolicyIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadEscalationPolicySnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as EscalationPolicySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.escalationPolicies.create', 'Create incident escalation policy'),
      resourceKind: 'incidents.incident_escalation_policy',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies EscalationPolicyUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<EscalationPolicyUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await incidentFindOne(em, IncidentEscalationPolicy, { id: after.id, ...scope })
    if (!record) return
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'deleted', record, { ...scope, id: record.id }, escalationPolicyIndexer)
  },
  redo: makeCreateRedo<IncidentEscalationPolicy, EscalationPolicySnapshot, IncidentEscalationPolicyCreateInput, ConfigCommandResult>({
    entityClass: IncidentEscalationPolicy,
    buildResult: (record) => ({ id: record.id, organizationId: record.organizationId, tenantId: record.tenantId, updatedAt: record.updatedAt }),
    indexer: escalationPolicyIndexer,
    transaction: true,
  }),
}

const updateEscalationPolicyCommand: CommandHandler<IncidentEscalationPolicyUpdateInput, ConfigCommandResult> = {
  id: 'incidents.escalation_policy.update',
  async prepare(input, ctx) {
    const parsed = escalationPolicyUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadEscalationPolicySnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const parsed = escalationPolicyUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await incidentFindOne(em, IncidentEscalationPolicy, { id: parsed.id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident escalation policy not found' })
    if (parsed.key !== undefined && parsed.key !== record.key) {
      await ensureUniqueEscalationPolicyKey(em, scope, parsed.key, record.id)
    }
    await withAtomicFlush(em, [() => {
      if (parsed.key !== undefined) record.key = parsed.key
      if (parsed.name !== undefined) record.name = parsed.name
      if (parsed.steps !== undefined) record.steps = parsed.steps
      if (parsed.repeatCount !== undefined) record.repeatCount = parsed.repeatCount
      if (parsed.isDefault !== undefined) record.isDefault = parsed.isDefault
      if (parsed.isActive !== undefined) record.isActive = parsed.isActive
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'updated', record, escalationPolicyIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadEscalationPolicySnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as EscalationPolicySnapshot | undefined
    const after = snapshots.after as EscalationPolicySnapshot | undefined
    if (!before || !after) return null
    if (snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.escalationPolicies.update', 'Update incident escalation policy'),
      resourceKind: 'incidents.incident_escalation_policy',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges({ ...before }, { ...after }, ESCALATION_POLICY_CHANGE_KEYS),
      payload: { undo: { before, after } satisfies EscalationPolicyUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<EscalationPolicyUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await incidentFindOne(em, IncidentEscalationPolicy, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createEscalationPolicyFromSnapshot(em, before)
        return
      }
      applyEscalationPolicySnapshot(record, before)
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'updated', record, { ...scope, id: before.id }, escalationPolicyIndexer)
  },
}

const deleteEscalationPolicyCommand: CommandHandler<ConfigDeleteInput, ConfigCommandResult> = {
  id: 'incidents.escalation_policy.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Incident escalation policy id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadEscalationPolicySnapshot(em, id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Incident escalation policy id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await incidentFindOne(em, IncidentEscalationPolicy, { id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident escalation policy not found' })
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'deleted', record, escalationPolicyIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as EscalationPolicySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.escalationPolicies.delete', 'Delete incident escalation policy'),
      resourceKind: 'incidents.incident_escalation_policy',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies EscalationPolicyUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<EscalationPolicyUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await incidentFindOne(em, IncidentEscalationPolicy, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createEscalationPolicyFromSnapshot(em, before)
        record.deletedAt = null
        return
      }
      applyEscalationPolicySnapshot(record, before)
      record.deletedAt = null
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'created', record, { ...scope, id: before.id }, escalationPolicyIndexer)
  },
}

registerCommand(createEscalationPolicyCommand)
registerCommand(updateEscalationPolicyCommand)
registerCommand(deleteEscalationPolicyCommand)
