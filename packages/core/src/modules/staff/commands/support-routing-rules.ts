import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StaffSupportRoutingRule, StaffTimeProject, StaffTimeTask, StaffTimeTaskStatus } from '../data/entities'
import { staffTimeProjectCrudEvents, staffTimeProjectCrudIndexer } from '../lib/crud'
import {
  staffSupportFallbackProjectCreateSchema,
  staffSupportRoutingRuleCreateSchema,
  staffSupportRoutingRuleUpdateSchema,
  type StaffSupportFallbackProjectCreateInput,
  type StaffSupportRoutingRuleCreateInput,
  type StaffSupportRoutingRuleUpdateInput,
} from '../data/validators'
import { findSupportTicketCategory } from '../lib/support/dictionaries'
import { ensureFallbackProjectAndRule, resolveContainerProjectCodeGenerator } from '../lib/support/seedDefaults'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  explicitStaffCommandScope,
  extractUndoPayload,
  lockLiveProjectForWrite,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffSnapshotScope,
} from './shared'

export const staffSupportRoutingRuleCommandIds = {
  create: 'staff.support.routing_rules.create',
  update: 'staff.support.routing_rules.update',
  delete: 'staff.support.routing_rules.delete',
  createFallbackProject: 'staff.support.routing_rules.create_fallback_project',
} as const

export const SUPPORT_ROUTING_RULE_RESOURCE_KIND = 'staff.support.routing_rule'

const routingRuleIndexer: CrudIndexerConfig<StaffSupportRoutingRule> = {
  entityType: 'staff:staff_support_routing_rule',
}

type Translate = (key: string, fallback: string) => string

type RoutingRuleSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  categoryValue: string | null
  timeProjectId: string
  isActive: boolean
  deletedAt: string | null
}

type RoutingRuleUndoPayload = {
  before?: RoutingRuleSnapshot | null
  after?: RoutingRuleSnapshot | null
}

function toSnapshot(rule: StaffSupportRoutingRule): RoutingRuleSnapshot {
  return {
    id: rule.id,
    tenantId: rule.tenantId,
    organizationId: rule.organizationId,
    categoryValue: rule.categoryValue ?? null,
    timeProjectId: rule.timeProjectId,
    isActive: rule.isActive,
    deletedAt: rule.deletedAt ? rule.deletedAt.toISOString() : null,
  }
}

async function loadSnapshot(
  em: EntityManager,
  id: string,
  scope?: StaffSnapshotScope | null,
): Promise<RoutingRuleSnapshot | null> {
  const rule = await em.findOne(StaffSupportRoutingRule, scopedStaffSnapshotWhere(id, scope))
  return rule ? toSnapshot(rule) : null
}

function notFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.support.errors.routingRuleNotFound', 'Routing rule not found.'),
  })
}

function fallbackRequiredError(translate: Translate): CrudHttpError {
  return new CrudHttpError(422, {
    code: 'support_fallback_rule_required',
    error: translate(
      'staff.support.errors.fallbackRuleRequired',
      'The fallback rule cannot be deleted or paused. Point it at another project instead.',
    ),
  })
}

function duplicateRuleError(translate: Translate, isFallback: boolean): CrudHttpError {
  const message = isFallback
    ? translate('staff.support.errors.fallbackRuleExists', 'This organization already has a fallback rule.')
    : translate('staff.support.errors.categoryRuleExists', 'This category already has a routing rule.')
  return new CrudHttpError(409, {
    code: 'support_routing_rule_duplicate',
    error: message,
    fieldErrors: { categoryValue: message },
  })
}

async function requireRoutableProject(
  em: EntityManager,
  timeProjectId: string,
  scope: { tenantId: string; organizationId: string },
  translate: Translate,
  options: { requireDefaultStatus?: boolean } = {},
): Promise<void> {
  const project = await lockLiveProjectForWrite(em, timeProjectId, explicitStaffCommandScope(scope.tenantId, scope.organizationId))
  if (!project) {
    const message = translate('staff.support.errors.projectNotFound', 'The selected project does not exist in this organization.')
    throw new CrudHttpError(422, { code: 'support_project_not_found', error: message, fieldErrors: { timeProjectId: message } })
  }
  if (options.requireDefaultStatus === false) return
  const defaultStatus = await em.findOne(
    StaffTimeTaskStatus,
    { timeProjectId, tenantId: scope.tenantId, organizationId: scope.organizationId, isDefault: true, deletedAt: null },
    { fields: ['id'] },
  )
  if (!defaultStatus) {
    const message = translate(
      'staff.support.errors.projectHasNoDefaultStatus',
      'The selected project has no default task status, so tickets cannot be filed on its board.',
    )
    throw new CrudHttpError(422, { code: 'support_project_no_default_status', error: message, fieldErrors: { timeProjectId: message } })
  }
}

async function requireKnownCategory(
  em: EntityManager,
  categoryValue: string,
  scope: { tenantId: string; organizationId: string },
  translate: Translate,
): Promise<void> {
  const category = await findSupportTicketCategory(em, scope, categoryValue)
  if (category) return
  const message = translate('staff.support.errors.categoryNotFound', 'This category does not exist in the support categories dictionary.')
  throw new CrudHttpError(422, { code: 'support_category_not_found', error: message, fieldErrors: { categoryValue: message } })
}

async function emitRuleSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  rule: StaffSupportRoutingRule,
): Promise<void> {
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine'),
    action,
    entity: rule,
    identifiers: { id: rule.id, organizationId: rule.organizationId, tenantId: rule.tenantId },
    indexer: routingRuleIndexer,
  })
}

const createRoutingRuleCommand: CommandHandler<StaffSupportRoutingRuleCreateInput, { ruleId: string }> = {
  id: staffSupportRoutingRuleCommandIds.create,
  async execute(rawInput, ctx) {
    const parsed = staffSupportRoutingRuleCreateSchema.parse(rawInput)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const { translate } = await resolveTranslations()
    const target = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const categoryValue = parsed.categoryValue ?? null
    const isFallback = categoryValue === null
    if (isFallback && parsed.isActive === false) throw fallbackRequiredError(translate)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let created: StaffSupportRoutingRule | null = null
    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            await requireRoutableProject(em, parsed.timeProjectId, target, translate)
            if (categoryValue !== null) await requireKnownCategory(em, categoryValue, target, translate)
            const duplicate = await em.findOne(
              StaffSupportRoutingRule,
              applyScopeToWhere<StaffSupportRoutingRule>({ categoryValue, deletedAt: null }, scope),
              { fields: ['id'] },
            )
            if (duplicate) throw duplicateRuleError(translate, isFallback)
          },
          () => {
            created = em.create(StaffSupportRoutingRule, {
              tenantId: parsed.tenantId,
              organizationId: parsed.organizationId,
              categoryValue,
              timeProjectId: parsed.timeProjectId,
              isActive: isFallback ? true : parsed.isActive ?? true,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            })
            em.persist(created)
          },
        ],
        { transaction: true, label: staffSupportRoutingRuleCommandIds.create },
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateRuleError(translate, isFallback)
      throw err
    }
    const record = created as StaffSupportRoutingRule | null
    if (!record) throw notFoundError(translate)
    await emitRuleSideEffects(ctx, 'created', record)
    return { ruleId: record.id }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadSnapshot(em, result.ruleId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.support.routingRules.create', 'Create support routing rule'),
      resourceKind: SUPPORT_ROUTING_RULE_RESOURCE_KIND,
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: { undo: { after: snapshot } satisfies RoutingRuleUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<RoutingRuleUndoPayload>(logEntry)?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const rule = await em.findOne(StaffSupportRoutingRule, scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)))
    if (!rule) return
    await withAtomicFlush(em, [() => {
      rule.deletedAt = new Date()
      rule.updatedAt = new Date()
    }], { transaction: true, label: `${staffSupportRoutingRuleCommandIds.create}.undo` })
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: rule,
      identifiers: { id: rule.id, organizationId: rule.organizationId, tenantId: rule.tenantId },
      indexer: routingRuleIndexer,
    })
  },
}

const updateRoutingRuleCommand: CommandHandler<StaffSupportRoutingRuleUpdateInput, { ruleId: string }> = {
  id: staffSupportRoutingRuleCommandIds.update,
  async prepare(rawInput, ctx) {
    const parsed = staffSupportRoutingRuleUpdateSchema.safeParse(rawInput)
    if (!parsed.success) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadSnapshot(em, parsed.data.id, staffSnapshotScopeFromContext(ctx))
    return before ? { before: { snapshot: before } } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffSupportRoutingRuleUpdateSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const rule = await em.findOne(
      StaffSupportRoutingRule,
      applyScopeToWhere<StaffSupportRoutingRule>({ id: parsed.id, deletedAt: null }, scope),
    )
    if (!rule) throw notFoundError(translate)
    ensureTenantScope(ctx, rule.tenantId)
    ensureOrganizationScope(ctx, rule.organizationId)
    const isFallback = (rule.categoryValue ?? null) === null
    if (isFallback && parsed.isActive === false) throw fallbackRequiredError(translate)
    const target = { tenantId: rule.tenantId, organizationId: rule.organizationId }

    await withAtomicFlush(
      em,
      [
        async () => {
          if (parsed.timeProjectId !== undefined) {
            await requireRoutableProject(em, parsed.timeProjectId, target, translate, {
              requireDefaultStatus: parsed.timeProjectId !== rule.timeProjectId,
            })
          }
          const locked = await em.findOne(
            StaffSupportRoutingRule,
            { id: rule.id, ...target, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
          )
          if (!locked) throw notFoundError(translate)
        },
        () => {
          if (parsed.timeProjectId !== undefined) rule.timeProjectId = parsed.timeProjectId
          if (parsed.isActive !== undefined && !isFallback) rule.isActive = parsed.isActive
          rule.updatedAt = new Date()
        },
      ],
      { transaction: true, label: staffSupportRoutingRuleCommandIds.update },
    )
    await emitRuleSideEffects(ctx, 'updated', rule)
    return { ruleId: rule.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as { snapshot?: RoutingRuleSnapshot } | undefined)?.snapshot
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.support.routingRules.update', 'Update support routing rule'),
      resourceKind: SUPPORT_ROUTING_RULE_RESOURCE_KIND,
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['timeProjectId', 'isActive'],
      ),
      payload: { undo: { before, after } satisfies RoutingRuleUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<RoutingRuleUndoPayload>(logEntry)?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const rule = await em.findOne(StaffSupportRoutingRule, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!rule) return
    const { translate } = await resolveTranslations()
    const target = { tenantId: rule.tenantId, organizationId: rule.organizationId }
    await withAtomicFlush(em, [async () => {
      await requireRoutableProject(em, before.timeProjectId, target, translate, {
        requireDefaultStatus: before.timeProjectId !== rule.timeProjectId,
      })
      const locked = await em.findOne(
        StaffSupportRoutingRule,
        { id: rule.id, ...target, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      )
      if (!locked) throw notFoundError(translate)
    }, () => {
      rule.timeProjectId = before.timeProjectId
      rule.isActive = before.isActive
      rule.updatedAt = new Date()
    }], { transaction: true, label: `${staffSupportRoutingRuleCommandIds.update}.undo` })
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: rule,
      identifiers: { id: rule.id, organizationId: rule.organizationId, tenantId: rule.tenantId },
      indexer: routingRuleIndexer,
    })
  },
}

const deleteRoutingRuleCommand: CommandHandler<{ id?: string }, { ruleId: string }> = {
  id: staffSupportRoutingRuleCommandIds.delete,
  async prepare(rawInput, ctx) {
    if (!rawInput?.id) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadSnapshot(em, rawInput.id, staffSnapshotScopeFromContext(ctx))
    return before ? { before: { snapshot: before } } : {}
  },
  async execute(rawInput, ctx) {
    const { translate } = await resolveTranslations()
    if (!rawInput?.id) throw notFoundError(translate)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const rule = await em.findOne(
      StaffSupportRoutingRule,
      applyScopeToWhere<StaffSupportRoutingRule>({ id: rawInput.id, deletedAt: null }, scope),
    )
    if (!rule) throw notFoundError(translate)
    ensureTenantScope(ctx, rule.tenantId)
    ensureOrganizationScope(ctx, rule.organizationId)
    if ((rule.categoryValue ?? null) === null) throw fallbackRequiredError(translate)
    await withAtomicFlush(em, [() => {
      rule.deletedAt = new Date()
      rule.updatedAt = new Date()
    }], { transaction: true, label: staffSupportRoutingRuleCommandIds.delete })
    await emitRuleSideEffects(ctx, 'deleted', rule)
    return { ruleId: rule.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = (snapshots.before as { snapshot?: RoutingRuleSnapshot } | undefined)?.snapshot
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.support.routingRules.delete', 'Delete support routing rule'),
      resourceKind: SUPPORT_ROUTING_RULE_RESOURCE_KIND,
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies RoutingRuleUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<RoutingRuleUndoPayload>(logEntry)?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const rule = await em.findOne(StaffSupportRoutingRule, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!rule || !rule.deletedAt) return
    const { translate } = await resolveTranslations()
    const categoryValue = rule.categoryValue ?? null
    const isFallback = categoryValue === null
    try {
      await withAtomicFlush(em, [
        async () => {
          await requireRoutableProject(em, rule.timeProjectId, { tenantId: rule.tenantId, organizationId: rule.organizationId }, translate)
          const newer = await em.findOne(
            StaffSupportRoutingRule,
            {
              tenantId: rule.tenantId,
              organizationId: rule.organizationId,
              categoryValue,
              deletedAt: null,
              id: { $ne: rule.id },
            },
            { fields: ['id'] },
          )
          if (newer) throw duplicateRuleError(translate, isFallback)
        },
        () => {
          rule.deletedAt = null
          rule.updatedAt = new Date()
        },
      ], { transaction: true, label: `${staffSupportRoutingRuleCommandIds.delete}.undo` })
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateRuleError(translate, isFallback)
      throw err
    }
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: rule,
      identifiers: { id: rule.id, organizationId: rule.organizationId, tenantId: rule.tenantId },
      indexer: routingRuleIndexer,
    })
  },
}

export type SupportFallbackProjectResult = {
  ruleId: string
  timeProjectId: string
  created: boolean
  taskStatusIds: string[]
  tenantId: string
  organizationId: string
}

type FallbackProjectUndoPayload = {
  ruleId: string
  timeProjectId: string
  taskStatusIds: string[]
  tenantId: string
  organizationId: string
}

async function emitProjectSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'deleted',
  project: StaffTimeProject,
  undo: boolean,
): Promise<void> {
  const params = {
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action,
    entity: project,
    identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
    events: staffTimeProjectCrudEvents,
    indexer: staffTimeProjectCrudIndexer,
  }
  if (undo) await emitCrudUndoSideEffects(params)
  else await emitCrudSideEffects(params)
}

const createFallbackProjectCommand: CommandHandler<StaffSupportFallbackProjectCreateInput, SupportFallbackProjectResult> = {
  id: staffSupportRoutingRuleCommandIds.createFallbackProject,
  async execute(rawInput, ctx) {
    const parsed = staffSupportFallbackProjectCreateSchema.parse(rawInput)
    commandInputScope(ctx, parsed.tenantId, parsed.organizationId)
    const { translate } = await resolveTranslations()
    const target = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await ensureFallbackProjectAndRule(em, target, {
      translate,
      generateCode: resolveContainerProjectCodeGenerator(ctx.container),
      projectName: translate('staff.support.fallbackProject.name', 'Customer support'),
    })
    if (result.created) {
      const project = await em.findOne(StaffTimeProject, { id: result.timeProjectId, ...target })
      if (project) await emitProjectSideEffects(ctx, 'created', project, false)
      const rule = await em.findOne(StaffSupportRoutingRule, { id: result.ruleId, ...target })
      if (rule) await emitRuleSideEffects(ctx, 'created', rule)
    }
    return { ...result, ...target }
  },
  buildLog: async ({ result }) => {
    if (!result.created) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.support.routingRules.createFallbackProject', 'Create support fallback project'),
      resourceKind: SUPPORT_ROUTING_RULE_RESOURCE_KIND,
      resourceId: result.ruleId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      context: { cacheAliases: [`${staffTimeProjectCrudEvents.module}.${staffTimeProjectCrudEvents.entity}`] },
      payload: {
        undo: {
          ruleId: result.ruleId,
          timeProjectId: result.timeProjectId,
          taskStatusIds: result.taskStatusIds,
          tenantId: result.tenantId,
          organizationId: result.organizationId,
        } satisfies FallbackProjectUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<FallbackProjectUndoPayload>(logEntry)
    if (!payload?.ruleId || !payload.timeProjectId) return
    const where = { tenantId: payload.tenantId, organizationId: payload.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const statusIds = Array.isArray(payload.taskStatusIds) ? payload.taskStatusIds : []
    const removal: {
      project: StaffTimeProject | null
      rule: StaffSupportRoutingRule | null
      statuses: StaffTimeTaskStatus[]
    } = { project: null, rule: null, statuses: [] }
    await withAtomicFlush(em, [async () => {
      removal.project = await em.findOne(
        StaffTimeProject,
        { id: payload.timeProjectId, ...where, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      const liveTaskCount = await em.count(StaffTimeTask, { timeProjectId: payload.timeProjectId, ...where, deletedAt: null })
      if (liveTaskCount > 0) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          code: 'support_fallback_project_in_use',
          error: translate(
            'staff.support.errors.fallbackProjectInUse',
            'The support project already has tasks, so creating it cannot be undone. Point the fallback rule at another project instead.',
          ),
        })
      }
      removal.statuses = statusIds.length > 0
        ? await em.find(StaffTimeTaskStatus, { id: { $in: statusIds }, timeProjectId: payload.timeProjectId, ...where, deletedAt: null })
        : []
    }, async () => {
      const now = new Date()
      const removedRuleCount = await em.nativeUpdate(
        StaffSupportRoutingRule,
        { id: payload.ruleId, ...where, timeProjectId: payload.timeProjectId, deletedAt: null },
        { deletedAt: now, updatedAt: now },
      )
      removal.rule = removedRuleCount > 0
        ? await em.findOne(StaffSupportRoutingRule, { id: payload.ruleId, ...where }, { refresh: true })
        : null
      if (removal.project) {
        removal.project.deletedAt = now
        removal.project.updatedAt = now
      }
      for (const status of removal.statuses) {
        status.deletedAt = now
        status.updatedAt = now
      }
    }], { transaction: true, label: `${staffSupportRoutingRuleCommandIds.createFallbackProject}.undo` })
    const { project, rule: ruleToRemove } = removal
    if (ruleToRemove) {
      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: ruleToRemove,
        identifiers: { id: ruleToRemove.id, organizationId: ruleToRemove.organizationId, tenantId: ruleToRemove.tenantId },
        indexer: routingRuleIndexer,
      })
    }
    if (project) await emitProjectSideEffects(ctx, 'deleted', project, true)
  },
}

registerCommand(createRoutingRuleCommand)
registerCommand(updateRoutingRuleCommand)
registerCommand(deleteRoutingRuleCommand)
registerCommand(createFallbackProjectCommand)
