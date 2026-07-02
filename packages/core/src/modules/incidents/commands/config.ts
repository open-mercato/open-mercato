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
  Incident,
  IncidentRole,
  IncidentSettings,
  IncidentSeverity,
  IncidentType,
  type IncidentUpdateCadence,
  type IncidentSlaTargets,
} from '../data/entities'
import {
  roleCreateSchema,
  roleUpdateSchema,
  settingsUpdateSchema,
  severityCreateSchema,
  severityUpdateSchema,
  type IncidentRoleCreateInput,
  type IncidentRoleUpdateInput,
  type IncidentSettingsUpdateInput,
  type IncidentSeverityCreateInput,
  type IncidentSeverityUpdateInput,
  type IncidentTypeCreateInput,
  type IncidentTypeUpdateInput,
  typeCreateSchema,
  typeUpdateSchema,
} from '../data/validators'

const DEFAULT_NUMBER_FORMAT = 'INC-{yyyy}{mm}{dd}-{seq:4}'

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

type SeveritySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  key: string
  label: string
  rank: number
  colorToken: string
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type TypeSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  key: string
  label: string
  defaultSeverityId: string | null
  defaultEscalationPolicyId: string | null
  defaultRoleIds: string[] | null
  requiredFieldsOnResolve: string[] | null
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type RoleSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  key: string
  label: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type SettingsSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  numberFormat: string
  ackTimeoutMinutes: number | null
  escalationTimeoutMinutes: number | null
  defaultEscalationPolicyId: string | null
  slaTargets: IncidentSlaTargets | null
  updateCadence: IncidentUpdateCadence | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type SeverityUndoPayload = UndoPayload<SeveritySnapshot>
type TypeUndoPayload = UndoPayload<TypeSnapshot>
type RoleUndoPayload = UndoPayload<RoleSnapshot>
type SettingsUndoPayload = UndoPayload<SettingsSnapshot>

const severityIndexer: CrudIndexerConfig<IncidentSeverity> = { entityType: E.incidents.incident_severity }
const typeIndexer: CrudIndexerConfig<IncidentType> = { entityType: E.incidents.incident_type }
const roleIndexer: CrudIndexerConfig<IncidentRole> = { entityType: E.incidents.incident_role }
const settingsIndexer: CrudIndexerConfig<IncidentSettings> = { entityType: E.incidents.incident_settings }

const SEVERITY_CHANGE_KEYS = ['key', 'label', 'rank', 'colorToken', 'isDefault', 'isActive'] as const
const TYPE_CHANGE_KEYS = [
  'key',
  'label',
  'defaultSeverityId',
  'defaultEscalationPolicyId',
  'defaultRoleIds',
  'requiredFieldsOnResolve',
  'isDefault',
  'isActive',
] as const
const ROLE_CHANGE_KEYS = ['key', 'label', 'isActive'] as const
const SETTINGS_CHANGE_KEYS = [
  'numberFormat',
  'ackTimeoutMinutes',
  'escalationTimeoutMinutes',
  'defaultEscalationPolicyId',
  'slaTargets',
  'updateCadence',
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

async function ensureUniqueSeverityKey(
  em: EntityManager,
  scope: IncidentScope,
  key: string,
  excludeId?: string,
): Promise<void> {
  const existing = await em.findOne(IncidentSeverity, { ...scope, key, deletedAt: null })
  assertUniqueConfigKey(existing?.id ?? null, excludeId)
}

async function ensureUniqueTypeKey(
  em: EntityManager,
  scope: IncidentScope,
  key: string,
  excludeId?: string,
): Promise<void> {
  const existing = await em.findOne(IncidentType, { ...scope, key, deletedAt: null })
  assertUniqueConfigKey(existing?.id ?? null, excludeId)
}

async function ensureUniqueRoleKey(
  em: EntityManager,
  scope: IncidentScope,
  key: string,
  excludeId?: string,
): Promise<void> {
  const existing = await em.findOne(IncidentRole, { ...scope, key, deletedAt: null })
  assertUniqueConfigKey(existing?.id ?? null, excludeId)
}

function requirePersistedSettings(record: IncidentSettings | null): IncidentSettings {
  if (!record) throw new CrudHttpError(500, { error: '[internal] Incident settings write did not produce a row' })
  return record
}

async function requireSeverityInScope(
  em: EntityManager,
  severityId: string | null | undefined,
  scope: IncidentScope,
): Promise<void> {
  if (!severityId) return
  const severity = await em.findOne(IncidentSeverity, { id: severityId, ...scope, deletedAt: null })
  if (!severity) throw new CrudHttpError(400, { error: 'Incident severity not found' })
}

async function requireRolesInScope(
  em: EntityManager,
  roleIds: string[] | null | undefined,
  scope: IncidentScope,
): Promise<void> {
  if (!roleIds?.length) return
  const uniqueRoleIds = Array.from(new Set(roleIds))
  const count = await em.count(IncidentRole, { id: { $in: uniqueRoleIds }, ...scope, deletedAt: null })
  if (count !== uniqueRoleIds.length) throw new CrudHttpError(400, { error: 'One or more incident roles were not found' })
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

async function loadSeveritySnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<SeveritySnapshot | null> {
  const record = await em.findOne(IncidentSeverity, { id, organizationId: scope.organizationId, tenantId: scope.tenantId })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    key: record.key,
    label: record.label,
    rank: record.rank,
    colorToken: record.colorToken,
    isDefault: record.isDefault,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: optionalIso(record.deletedAt),
  }
}

function applySeveritySnapshot(record: IncidentSeverity, snapshot: SeveritySnapshot): void {
  record.key = snapshot.key
  record.label = snapshot.label
  record.rank = snapshot.rank
  record.colorToken = snapshot.colorToken
  record.isDefault = snapshot.isDefault
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createSeverityFromSnapshot(em: EntityManager, snapshot: SeveritySnapshot): IncidentSeverity {
  const record = em.create(IncidentSeverity, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    key: snapshot.key,
    label: snapshot.label,
    rank: snapshot.rank,
    colorToken: snapshot.colorToken,
    isDefault: snapshot.isDefault,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(record)
  return record
}

async function loadTypeSnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<TypeSnapshot | null> {
  const record = await em.findOne(IncidentType, { id, organizationId: scope.organizationId, tenantId: scope.tenantId })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    key: record.key,
    label: record.label,
    defaultSeverityId: record.defaultSeverityId ?? null,
    defaultEscalationPolicyId: record.defaultEscalationPolicyId ?? null,
    defaultRoleIds: record.defaultRoleIds ?? null,
    requiredFieldsOnResolve: record.requiredFieldsOnResolve ?? null,
    isDefault: record.isDefault,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: optionalIso(record.deletedAt),
  }
}

function applyTypeSnapshot(record: IncidentType, snapshot: TypeSnapshot): void {
  record.key = snapshot.key
  record.label = snapshot.label
  record.defaultSeverityId = snapshot.defaultSeverityId
  record.defaultEscalationPolicyId = snapshot.defaultEscalationPolicyId
  record.defaultRoleIds = snapshot.defaultRoleIds
  record.requiredFieldsOnResolve = snapshot.requiredFieldsOnResolve
  record.isDefault = snapshot.isDefault
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createTypeFromSnapshot(em: EntityManager, snapshot: TypeSnapshot): IncidentType {
  const record = em.create(IncidentType, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    key: snapshot.key,
    label: snapshot.label,
    defaultSeverityId: snapshot.defaultSeverityId,
    defaultEscalationPolicyId: snapshot.defaultEscalationPolicyId,
    defaultRoleIds: snapshot.defaultRoleIds,
    requiredFieldsOnResolve: snapshot.requiredFieldsOnResolve,
    isDefault: snapshot.isDefault,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(record)
  return record
}

async function loadRoleSnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<RoleSnapshot | null> {
  const record = await em.findOne(IncidentRole, { id, ...scope })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    key: record.key,
    label: record.label,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: optionalIso(record.deletedAt),
  }
}

function applyRoleSnapshot(record: IncidentRole, snapshot: RoleSnapshot): void {
  record.key = snapshot.key
  record.label = snapshot.label
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createRoleFromSnapshot(em: EntityManager, snapshot: RoleSnapshot): IncidentRole {
  const record = em.create(IncidentRole, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    key: snapshot.key,
    label: snapshot.label,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(record)
  return record
}

async function loadSettingsSnapshotByScope(
  em: EntityManager,
  scope: IncidentScope,
): Promise<SettingsSnapshot | null> {
  const record = await em.findOne(IncidentSettings, { ...scope, deletedAt: null })
  return record ? serializeSettings(record) : null
}

async function loadSettingsSnapshotById(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<SettingsSnapshot | null> {
  const record = await em.findOne(IncidentSettings, { id, ...scope })
  return record ? serializeSettings(record) : null
}

function serializeSettings(record: IncidentSettings): SettingsSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    numberFormat: record.numberFormat,
    ackTimeoutMinutes: record.ackTimeoutMinutes ?? null,
    escalationTimeoutMinutes: record.escalationTimeoutMinutes ?? null,
    defaultEscalationPolicyId: record.defaultEscalationPolicyId ?? null,
    slaTargets: record.slaTargets ?? null,
    updateCadence: record.updateCadence ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: optionalIso(record.deletedAt),
  }
}

function applySettingsSnapshot(record: IncidentSettings, snapshot: SettingsSnapshot): void {
  record.numberFormat = snapshot.numberFormat
  record.ackTimeoutMinutes = snapshot.ackTimeoutMinutes
  record.escalationTimeoutMinutes = snapshot.escalationTimeoutMinutes
  record.defaultEscalationPolicyId = snapshot.defaultEscalationPolicyId
  record.slaTargets = snapshot.slaTargets
  record.updateCadence = snapshot.updateCadence
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createSettingsFromSnapshot(em: EntityManager, snapshot: SettingsSnapshot): IncidentSettings {
  const record = em.create(IncidentSettings, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    numberFormat: snapshot.numberFormat,
    ackTimeoutMinutes: snapshot.ackTimeoutMinutes,
    escalationTimeoutMinutes: snapshot.escalationTimeoutMinutes,
    defaultEscalationPolicyId: snapshot.defaultEscalationPolicyId,
    slaTargets: snapshot.slaTargets,
    updateCadence: snapshot.updateCadence,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(record)
  return record
}

const createSeverityCommand: CommandHandler<IncidentSeverityCreateInput, ConfigCommandResult> = {
  id: 'incidents.incident_severities.create',
  async execute(input, ctx) {
    const parsed = severityCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureUniqueSeverityKey(em, scope, parsed.key)
    const now = new Date()
    let record!: IncidentSeverity
    await withAtomicFlush(em, [
      () => {
        record = em.create(IncidentSeverity, {
          ...scope,
          key: parsed.key,
          label: parsed.label,
          rank: parsed.rank,
          colorToken: parsed.colorToken,
          isDefault: parsed.isDefault ?? false,
          isActive: parsed.isActive ?? true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(record)
      },
    ], { transaction: true })
    await emitConfigSideEffects(ctx, 'created', record, severityIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadSeveritySnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as SeveritySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.severities.create', 'Create incident severity'),
      resourceKind: 'incidents.incident_severity',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies SeverityUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<SeverityUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentSeverity, { id: after.id, ...scope })
    if (!record) return
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'deleted', record, { ...scope, id: record.id }, severityIndexer)
  },
  redo: makeCreateRedo<IncidentSeverity, SeveritySnapshot, IncidentSeverityCreateInput, ConfigCommandResult>({
    entityClass: IncidentSeverity,
    buildResult: (record) => ({ id: record.id, organizationId: record.organizationId, tenantId: record.tenantId, updatedAt: record.updatedAt }),
    indexer: severityIndexer,
    transaction: true,
  }),
}

const updateSeverityCommand: CommandHandler<IncidentSeverityUpdateInput, ConfigCommandResult> = {
  id: 'incidents.incident_severities.update',
  async prepare(input, ctx) {
    const parsed = severityUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadSeveritySnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const parsed = severityUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentSeverity, { id: parsed.id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident severity not found' })
    if (parsed.key !== undefined && parsed.key !== record.key) {
      await ensureUniqueSeverityKey(em, scope, parsed.key, record.id)
    }
    await withAtomicFlush(em, [() => {
      if (parsed.key !== undefined) record.key = parsed.key
      if (parsed.label !== undefined) record.label = parsed.label
      if (parsed.rank !== undefined) record.rank = parsed.rank
      if (parsed.colorToken !== undefined) record.colorToken = parsed.colorToken
      if (parsed.isDefault !== undefined) record.isDefault = parsed.isDefault
      if (parsed.isActive !== undefined) record.isActive = parsed.isActive
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'updated', record, severityIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadSeveritySnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as SeveritySnapshot | undefined
    const after = snapshots.after as SeveritySnapshot | undefined
    if (!before || !after) return null
    if (snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.severities.update', 'Update incident severity'),
      resourceKind: 'incidents.incident_severity',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges({ ...before }, { ...after }, SEVERITY_CHANGE_KEYS),
      payload: { undo: { before, after } satisfies SeverityUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<SeverityUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentSeverity, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createSeverityFromSnapshot(em, before)
        return
      }
      applySeveritySnapshot(record, before)
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'updated', record, { ...scope, id: before.id }, severityIndexer)
  },
}

const deleteSeverityCommand: CommandHandler<ConfigDeleteInput, ConfigCommandResult> = {
  id: 'incidents.incident_severities.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Incident severity id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadSeveritySnapshot(em, id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Incident severity id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentSeverity, { id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident severity not found' })
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'deleted', record, severityIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as SeveritySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.severities.delete', 'Delete incident severity'),
      resourceKind: 'incidents.incident_severity',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies SeverityUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<SeverityUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentSeverity, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createSeverityFromSnapshot(em, before)
        record.deletedAt = null
        return
      }
      applySeveritySnapshot(record, before)
      record.deletedAt = null
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'created', record, { ...scope, id: before.id }, severityIndexer)
  },
}

const createTypeCommand: CommandHandler<IncidentTypeCreateInput, ConfigCommandResult> = {
  id: 'incidents.incident_types.create',
  async execute(input, ctx) {
    const parsed = typeCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureUniqueTypeKey(em, scope, parsed.key)
    await requireSeverityInScope(em, parsed.defaultSeverityId, scope)
    await requireRolesInScope(em, parsed.defaultRoleIds, scope)
    const now = new Date()
    let record!: IncidentType
    await withAtomicFlush(em, [() => {
      record = em.create(IncidentType, {
        ...scope,
        key: parsed.key,
        label: parsed.label,
        defaultSeverityId: parsed.defaultSeverityId ?? null,
        defaultEscalationPolicyId: parsed.defaultEscalationPolicyId ?? null,
        defaultRoleIds: parsed.defaultRoleIds ?? null,
        requiredFieldsOnResolve: parsed.requiredFieldsOnResolve ?? null,
        isDefault: parsed.isDefault ?? false,
        isActive: parsed.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(record)
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'created', record, typeIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadTypeSnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as TypeSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.types.create', 'Create incident type'),
      resourceKind: 'incidents.incident_type',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies TypeUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<TypeUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentType, { id: after.id, ...scope })
    if (!record) return
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'deleted', record, { ...scope, id: record.id }, typeIndexer)
  },
  redo: makeCreateRedo<IncidentType, TypeSnapshot, IncidentTypeCreateInput, ConfigCommandResult>({
    entityClass: IncidentType,
    buildResult: (record) => ({ id: record.id, organizationId: record.organizationId, tenantId: record.tenantId, updatedAt: record.updatedAt }),
    indexer: typeIndexer,
    transaction: true,
  }),
}

const updateTypeCommand: CommandHandler<IncidentTypeUpdateInput, ConfigCommandResult> = {
  id: 'incidents.incident_types.update',
  async prepare(input, ctx) {
    const parsed = typeUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadTypeSnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const parsed = typeUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentType, { id: parsed.id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident type not found' })
    if (parsed.key !== undefined && parsed.key !== record.key) {
      await ensureUniqueTypeKey(em, scope, parsed.key, record.id)
    }
    if (parsed.defaultSeverityId !== undefined) await requireSeverityInScope(em, parsed.defaultSeverityId, scope)
    if (parsed.defaultRoleIds !== undefined) await requireRolesInScope(em, parsed.defaultRoleIds, scope)
    await withAtomicFlush(em, [() => {
      if (parsed.key !== undefined) record.key = parsed.key
      if (parsed.label !== undefined) record.label = parsed.label
      if (parsed.defaultSeverityId !== undefined) record.defaultSeverityId = parsed.defaultSeverityId ?? null
      if (parsed.defaultEscalationPolicyId !== undefined) record.defaultEscalationPolicyId = parsed.defaultEscalationPolicyId ?? null
      if (parsed.defaultRoleIds !== undefined) record.defaultRoleIds = parsed.defaultRoleIds ?? null
      if (parsed.requiredFieldsOnResolve !== undefined) {
        record.requiredFieldsOnResolve = parsed.requiredFieldsOnResolve ?? null
      }
      if (parsed.isDefault !== undefined) record.isDefault = parsed.isDefault
      if (parsed.isActive !== undefined) record.isActive = parsed.isActive
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'updated', record, typeIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadTypeSnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TypeSnapshot | undefined
    const after = snapshots.after as TypeSnapshot | undefined
    if (!before || !after) return null
    if (snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.types.update', 'Update incident type'),
      resourceKind: 'incidents.incident_type',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges({ ...before }, { ...after }, TYPE_CHANGE_KEYS),
      payload: { undo: { before, after } satisfies TypeUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TypeUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentType, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createTypeFromSnapshot(em, before)
        return
      }
      applyTypeSnapshot(record, before)
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'updated', record, { ...scope, id: before.id }, typeIndexer)
  },
}

const deleteTypeCommand: CommandHandler<ConfigDeleteInput, ConfigCommandResult> = {
  id: 'incidents.incident_types.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Incident type id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadTypeSnapshot(em, id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Incident type id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentType, { id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident type not found' })
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'deleted', record, typeIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TypeSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.types.delete', 'Delete incident type'),
      resourceKind: 'incidents.incident_type',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies TypeUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TypeUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentType, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createTypeFromSnapshot(em, before)
        record.deletedAt = null
        return
      }
      applyTypeSnapshot(record, before)
      record.deletedAt = null
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'created', record, { ...scope, id: before.id }, typeIndexer)
  },
}

const createRoleCommand: CommandHandler<IncidentRoleCreateInput, ConfigCommandResult> = {
  id: 'incidents.incident_roles.create',
  async execute(input, ctx) {
    const parsed = roleCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureUniqueRoleKey(em, scope, parsed.key)
    const now = new Date()
    let record!: IncidentRole
    await withAtomicFlush(em, [() => {
      record = em.create(IncidentRole, {
        ...scope,
        key: parsed.key,
        label: parsed.label,
        isActive: parsed.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(record)
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'created', record, roleIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadRoleSnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as RoleSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.roles.create', 'Create incident role'),
      resourceKind: 'incidents.incident_role',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies RoleUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<RoleUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentRole, { id: after.id, ...scope })
    if (!record) return
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'deleted', record, { ...scope, id: record.id }, roleIndexer)
  },
  redo: makeCreateRedo<IncidentRole, RoleSnapshot, IncidentRoleCreateInput, ConfigCommandResult>({
    entityClass: IncidentRole,
    buildResult: (record) => ({ id: record.id, organizationId: record.organizationId, tenantId: record.tenantId, updatedAt: record.updatedAt }),
    indexer: roleIndexer,
    transaction: true,
  }),
}

const updateRoleCommand: CommandHandler<IncidentRoleUpdateInput, ConfigCommandResult> = {
  id: 'incidents.incident_roles.update',
  async prepare(input, ctx) {
    const parsed = roleUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadRoleSnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const parsed = roleUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentRole, { id: parsed.id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident role not found' })
    if (parsed.key !== undefined && parsed.key !== record.key) {
      await ensureUniqueRoleKey(em, scope, parsed.key, record.id)
    }
    await withAtomicFlush(em, [() => {
      if (parsed.key !== undefined) record.key = parsed.key
      if (parsed.label !== undefined) record.label = parsed.label
      if (parsed.isActive !== undefined) record.isActive = parsed.isActive
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'updated', record, roleIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadRoleSnapshot(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as RoleSnapshot | undefined
    const after = snapshots.after as RoleSnapshot | undefined
    if (!before || !after) return null
    if (snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.roles.update', 'Update incident role'),
      resourceKind: 'incidents.incident_role',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges({ ...before }, { ...after }, ROLE_CHANGE_KEYS),
      payload: { undo: { before, after } satisfies RoleUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<RoleUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentRole, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createRoleFromSnapshot(em, before)
        return
      }
      applyRoleSnapshot(record, before)
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'updated', record, { ...scope, id: before.id }, roleIndexer)
  },
}

const deleteRoleCommand: CommandHandler<ConfigDeleteInput, ConfigCommandResult> = {
  id: 'incidents.incident_roles.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Incident role id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadRoleSnapshot(em, id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Incident role id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(IncidentRole, { id, ...scope, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Incident role not found' })
    await withAtomicFlush(em, [() => {
      record.deletedAt = new Date()
      record.isActive = false
      record.updatedAt = new Date()
    }], { transaction: true })
    await emitConfigSideEffects(ctx, 'deleted', record, roleIndexer)
    return { id: record.id, ...scope, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as RoleSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.roles.delete', 'Delete incident role'),
      resourceKind: 'incidents.incident_role',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies RoleUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<RoleUndoPayload>(logEntry)?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentRole, { id: before.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createRoleFromSnapshot(em, before)
        record.deletedAt = null
        return
      }
      applyRoleSnapshot(record, before)
      record.deletedAt = null
    }], { transaction: true })
    await emitConfigUndoSideEffects(ctx, 'created', record, { ...scope, id: before.id }, roleIndexer)
  },
}

const updateSettingsCommand: CommandHandler<IncidentSettingsUpdateInput, ConfigCommandResult> = {
  id: 'incidents.settings.update',
  async prepare(input, ctx) {
    const parsed = settingsUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = parsed.id
      ? await loadSettingsSnapshotById(em, parsed.id, scope)
      : await loadSettingsSnapshotByScope(em, scope)
    return before ? { before } : { before: null }
  },
  async execute(input, ctx) {
    const parsed = settingsUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = parsed.id
      ? await em.findOne(IncidentSettings, { id: parsed.id, ...scope, deletedAt: null })
      : await em.findOne(IncidentSettings, { ...scope, deletedAt: null })
    if (parsed.id && !record) throw new CrudHttpError(404, { error: 'Incident settings not found' })
    const now = new Date()
    let wasCreated = false
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = em.create(IncidentSettings, {
          ...scope,
          numberFormat: parsed.numberFormat ?? DEFAULT_NUMBER_FORMAT,
          ackTimeoutMinutes: parsed.ackTimeoutMinutes ?? null,
          escalationTimeoutMinutes: parsed.escalationTimeoutMinutes ?? null,
          defaultEscalationPolicyId: parsed.defaultEscalationPolicyId ?? null,
          slaTargets: parsed.slaTargets ?? null,
          updateCadence: parsed.updateCadence ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(record)
        wasCreated = true
        return
      }
      if (parsed.numberFormat !== undefined) record.numberFormat = parsed.numberFormat
      if (parsed.ackTimeoutMinutes !== undefined) record.ackTimeoutMinutes = parsed.ackTimeoutMinutes
      if (parsed.escalationTimeoutMinutes !== undefined) record.escalationTimeoutMinutes = parsed.escalationTimeoutMinutes
      if (parsed.defaultEscalationPolicyId !== undefined) record.defaultEscalationPolicyId = parsed.defaultEscalationPolicyId
      if (parsed.slaTargets !== undefined) record.slaTargets = parsed.slaTargets
      if (parsed.updateCadence !== undefined) record.updateCadence = parsed.updateCadence
      record.updatedAt = now
    }], { transaction: true })
    const savedSettings = requirePersistedSettings(record)
    await emitConfigSideEffects(ctx, wasCreated ? 'created' : 'updated', savedSettings, settingsIndexer)
    return { id: savedSettings.id, ...scope, updatedAt: savedSettings.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadSettingsSnapshotById(em, result.id, result)
  },
  buildLog: async ({ snapshots }) => {
    const before = (snapshots.before ?? null) as SettingsSnapshot | null
    const after = snapshots.after as SettingsSnapshot | undefined
    if (!after) return null
    if (before && snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.settings.update', 'Update incident settings'),
      resourceKind: 'incidents.incident_settings',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: before ? buildChanges({ ...before }, { ...after }, SETTINGS_CHANGE_KEYS) : null,
      payload: { undo: { before, after } satisfies SettingsUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<SettingsUndoPayload>(logEntry)
    const before = undo?.before ?? null
    const after = undo?.after ?? null
    const snapshot = before ?? after
    if (!snapshot) return
    const scope = { organizationId: snapshot.organizationId, tenantId: snapshot.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentSettings, { id: snapshot.id, ...scope })
    await withAtomicFlush(em, [() => {
      if (before) {
        if (!record) {
          record = createSettingsFromSnapshot(em, before)
          return
        }
        applySettingsSnapshot(record, before)
        return
      }
      if (record) {
        record.deletedAt = new Date()
        record.updatedAt = new Date()
      }
    }], { transaction: true })
    if (before) {
      await emitConfigUndoSideEffects(ctx, 'updated', record, { ...scope, id: before.id }, settingsIndexer)
    } else if (after) {
      await emitConfigUndoSideEffects(ctx, 'deleted', record, { ...scope, id: after.id }, settingsIndexer)
    }
  },
  redo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<SettingsUndoPayload>(logEntry)?.after
    if (!after) throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for settings update' })
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(IncidentSettings, { id: after.id, ...scope })
    let wasCreated = false
    await withAtomicFlush(em, [() => {
      if (!record) {
        record = createSettingsFromSnapshot(em, after)
        wasCreated = true
        return
      }
      applySettingsSnapshot(record, after)
    }], { transaction: true })
    const savedSettings = requirePersistedSettings(record)
    await emitConfigSideEffects(ctx, wasCreated ? 'created' : 'updated', savedSettings, settingsIndexer)
    return { id: savedSettings.id, ...scope, updatedAt: savedSettings.updatedAt }
  },
}

registerCommand(createSeverityCommand)
registerCommand(updateSeverityCommand)
registerCommand(deleteSeverityCommand)
registerCommand(createTypeCommand)
registerCommand(updateTypeCommand)
registerCommand(deleteTypeCommand)
registerCommand(createRoleCommand)
registerCommand(updateRoleCommand)
registerCommand(deleteRoleCommand)
registerCommand(updateSettingsCommand)
