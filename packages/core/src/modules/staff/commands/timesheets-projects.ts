import { z } from 'zod'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  StaffTeamMember,
  StaffTimeEntry,
  StaffTimeProject,
  StaffTimeProjectMember,
  StaffTimeReport,
  type StaffTimeProjectStatus,
  type StaffTimeProjectBudgetKind,
  type StaffTimeProjectMemberStatus,
} from '../data/entities'

const timeProjectCrudIndexer: CrudIndexerConfig<StaffTimeProject> = {
  entityType: 'staff:staff_time_project',
}
const timeProjectMemberCrudIndexer: CrudIndexerConfig<StaffTimeProjectMember> = {
  entityType: 'staff:staff_time_project_member',
}
import {
  staffTimeProjectCreateSchema,
  staffTimeProjectUpdateSchema,
  staffTimeProjectChangeCurrencySchema,
  staffTimeProjectMemberAssignSchema,
  staffTimeProjectMemberUpdateSchema,
  type StaffTimeProjectCreateInput,
  type StaffTimeProjectUpdateInput,
  type StaffTimeProjectMemberAssignInput,
  type StaffTimeProjectMemberUpdateInput,
} from '../data/validators'
import { staffTimeProjectCrudEvents, staffTimeProjectMemberCrudEvents } from '../lib/crud'
import { DEFAULT_BUDGET_WARN_AT_PERCENT } from '../lib/timesheets-projects/budgetBurn'
import { seedProjectTaskStatuses } from '../lib/timesheets-tasks/seedProjectStatuses'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  scopeForDecryption,
  scopedStaffSnapshotWhere,
  staffSnapshotDecryptionScope,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffSnapshotScope,
} from './shared'

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === '23505') return true
  const message = (error as { message?: string }).message
  return typeof message === 'string' && message.toLowerCase().includes('duplicate key')
}

type TimeProjectSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  customerId: string | null
  customerSnapshot: Record<string, unknown> | null
  code: string
  description: string | null
  projectType: string | null
  color: string | null
  status: string
  ownerUserId: string | null
  costCenter: string | null
  startDate: string | null
  hourlyRate: string | null
  currencyCode: string | null
  billableByDefault: boolean
  budgetKind: string
  budgetValue: string | null
  budgetWarnAtPercent: number
  deletedAt: string | null
}

type TimeProjectUndoPayload = {
  before?: TimeProjectSnapshot | null
  after?: TimeProjectSnapshot | null
}

type TimeProjectMemberSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  staffMemberId: string
  role: string | null
  status: string
  showInGrid: boolean
  assignedStartDate: string
  assignedEndDate: string | null
  deletedAt: string | null
}

type TimeProjectMemberUndoPayload = {
  before?: TimeProjectMemberSnapshot | null
  after?: TimeProjectMemberSnapshot | null
}

async function loadTimeProjectSnapshot(em: EntityManager, id: string, scope?: StaffSnapshotScope | null): Promise<TimeProjectSnapshot | null> {
  const project = await findOneWithDecryption(
    em,
    StaffTimeProject,
    scopedStaffSnapshotWhere(id, scope),
    undefined,
    staffSnapshotDecryptionScope(scope),
  )
  if (!project) return null
  return {
    id: project.id,
    tenantId: project.tenantId,
    organizationId: project.organizationId,
    name: project.name,
    customerId: project.customerId ?? null,
    customerSnapshot: project.customerSnapshot ?? null,
    code: project.code,
    description: project.description ?? null,
    projectType: project.projectType ?? null,
    color: project.color ?? null,
    status: project.status,
    ownerUserId: project.ownerUserId ?? null,
    costCenter: project.costCenter ?? null,
    startDate: project.startDate instanceof Date ? project.startDate.toISOString().split('T')[0] : (project.startDate ?? null),
    hourlyRate: project.hourlyRate ?? null,
    currencyCode: project.currencyCode ?? null,
    billableByDefault: project.billableByDefault ?? true,
    budgetKind: project.budgetKind ?? 'none',
    budgetValue: project.budgetValue ?? null,
    budgetWarnAtPercent: project.budgetWarnAtPercent ?? DEFAULT_BUDGET_WARN_AT_PERCENT,
    deletedAt: project.deletedAt ? project.deletedAt.toISOString() : null,
  }
}

async function loadTimeProjectMemberSnapshot(em: EntityManager, id: string, scope?: StaffSnapshotScope | null): Promise<TimeProjectMemberSnapshot | null> {
  const member = await findOneWithDecryption(
    em,
    StaffTimeProjectMember,
    scopedStaffSnapshotWhere(id, scope),
    undefined,
    staffSnapshotDecryptionScope(scope),
  )
  if (!member) return null
  return {
    id: member.id,
    tenantId: member.tenantId,
    organizationId: member.organizationId,
    timeProjectId: member.timeProjectId,
    staffMemberId: member.staffMemberId,
    role: member.role ?? null,
    status: member.status,
    showInGrid: member.showInGrid ?? false,
    assignedStartDate: member.assignedStartDate instanceof Date ? member.assignedStartDate.toISOString().split('T')[0] : String(member.assignedStartDate),
    assignedEndDate: member.assignedEndDate instanceof Date ? member.assignedEndDate.toISOString().split('T')[0] : (member.assignedEndDate ?? null),
    deletedAt: member.deletedAt ? member.deletedAt.toISOString() : null,
  }
}

function timeProjectSeedFromSnapshot(snapshot: TimeProjectSnapshot): Record<string, unknown> {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
    name: snapshot.name,
    customerId: snapshot.customerId ?? null,
    customerSnapshot: snapshot.customerSnapshot ?? null,
    code: snapshot.code,
    description: snapshot.description ?? null,
    projectType: snapshot.projectType ?? null,
    color: snapshot.color ?? null,
    status: (snapshot.status ?? 'active') as StaffTimeProjectStatus,
    ownerUserId: snapshot.ownerUserId ?? null,
    costCenter: snapshot.costCenter ?? null,
    startDate: snapshot.startDate ? new Date(snapshot.startDate) : null,
    hourlyRate: snapshot.hourlyRate ?? null,
    currencyCode: snapshot.currencyCode ?? null,
    billableByDefault: snapshot.billableByDefault ?? true,
    budgetKind: (snapshot.budgetKind ?? 'none') as StaffTimeProjectBudgetKind,
    budgetValue: snapshot.budgetValue ?? null,
    budgetWarnAtPercent: snapshot.budgetWarnAtPercent ?? DEFAULT_BUDGET_WARN_AT_PERCENT,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

function timeProjectMemberSeedFromSnapshot(snapshot: TimeProjectMemberSnapshot): Record<string, unknown> {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
    timeProjectId: snapshot.timeProjectId,
    staffMemberId: snapshot.staffMemberId,
    role: snapshot.role ?? null,
    status: (snapshot.status ?? 'active') as StaffTimeProjectMemberStatus,
    showInGrid: snapshot.showInGrid ?? false,
    assignedStartDate: new Date(snapshot.assignedStartDate),
    assignedEndDate: snapshot.assignedEndDate ? new Date(snapshot.assignedEndDate) : null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

const createTimeProjectCommand: CommandHandler<StaffTimeProjectCreateInput, { timeProjectId: string }> = {
  id: 'staff.timesheets.time_projects.create',
  async execute(rawInput, ctx) {
    const parsed = staffTimeProjectCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    commandInputScope(ctx, parsed.tenantId, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const project = em.create(StaffTimeProject, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      customerId: parsed.customerId,
      customerSnapshot: parsed.customerSnapshot ?? null,
      code: parsed.code,
      description: parsed.description ?? null,
      projectType: parsed.projectType ?? null,
      color: parsed.color ?? null,
      status: parsed.status ?? 'active',
      ownerUserId: parsed.ownerUserId ?? null,
      costCenter: parsed.costCenter ?? null,
      startDate: parsed.startDate ?? null,
      hourlyRate: parsed.hourlyRate ?? null,
      // D-3: creation is the one moment the currency may be chosen freely.
      currencyCode: parsed.currencyCode ?? null,
      billableByDefault: parsed.billableByDefault ?? true,
      budgetKind: parsed.budgetKind ?? 'none',
      budgetValue: parsed.budgetValue ?? null,
      budgetWarnAtPercent: parsed.budgetWarnAtPercent ?? DEFAULT_BUDGET_WARN_AT_PERCENT,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    const { translate } = await resolveTranslations()
    try {
      // D-1: the project and its Kanban columns are one transaction. The template
      // can only be seeded once the insert has handed back the project's id, so
      // the two writes are separate phases — but a rollback takes both, and a
      // project therefore never exists with an empty board.
      await withAtomicFlush(
        em,
        [
          () => {
            em.persist(project)
          },
          () => {
            seedProjectTaskStatuses(
              em,
              { tenantId: project.tenantId, organizationId: project.organizationId, timeProjectId: project.id },
              translate,
            )
          },
        ],
        { transaction: true, label: 'staff.timesheets.time_projects.create' },
      )
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new CrudHttpError(409, {
          error: translate('staff.timesheets.errors.projectCodeDuplicate', 'A project with this code already exists.'),
          fieldErrors: { code: translate('staff.timesheets.errors.projectCodeDuplicate', 'A project with this code already exists.') },
        })
      }
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: project,
      identifiers: {
        id: project.id,
        organizationId: project.organizationId,
        tenantId: project.tenantId,
      },
      events: staffTimeProjectCrudEvents,
      indexer: timeProjectCrudIndexer,
    })

    return { timeProjectId: project.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeProjectSnapshot(em, result.timeProjectId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeProjectSnapshot(em, result.timeProjectId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_projects.create', 'Create time project'),
      resourceKind: 'staff.timesheets.time_project',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies TimeProjectUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeProjectUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const project = await em.findOne(StaffTimeProject, scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)))
    if (project) {
      project.deletedAt = new Date()
      await em.flush()

      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: project,
        identifiers: {
          id: project.id,
          organizationId: project.organizationId,
          tenantId: project.tenantId,
        },
        events: staffTimeProjectCrudEvents,
      })
    }
  },
  redo: makeCreateRedo<StaffTimeProject, TimeProjectSnapshot, StaffTimeProjectCreateInput, { timeProjectId: string }>({
    entityClass: StaffTimeProject,
    getSnapshotId: (snapshot) => snapshot.id,
    seedFromSnapshot: timeProjectSeedFromSnapshot,
    buildResult: (entity) => ({ timeProjectId: entity.id }),
    events: staffTimeProjectCrudEvents,
    indexer: timeProjectCrudIndexer,
  }),
}

const updateTimeProjectCommand: CommandHandler<StaffTimeProjectUpdateInput, { timeProjectId: string }> = {
  id: 'staff.timesheets.time_projects.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTimeProjectUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTimeProjectSnapshot(em, parsed.id, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeProjectUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const project = await findOneWithDecryption(
      em,
      StaffTimeProject,
      applyScopeToWhere<StaffTimeProject>({ id: parsed.id, deletedAt: null }, scope),
      undefined,
      scopeForDecryption(scope),
    )
    if (!project) throw new CrudHttpError(404, { error: 'Time project not found.' })
    ensureTenantScope(ctx, project.tenantId)
    ensureOrganizationScope(ctx, project.organizationId)

    if (parsed.name !== undefined) project.name = parsed.name
    if (parsed.customerId !== undefined) project.customerId = parsed.customerId ?? null
    if (parsed.customerSnapshot !== undefined) project.customerSnapshot = parsed.customerSnapshot ?? null
    if (parsed.code !== undefined) project.code = parsed.code
    if (parsed.description !== undefined) project.description = parsed.description ?? null
    if (parsed.projectType !== undefined) project.projectType = parsed.projectType ?? null
    if (parsed.color !== undefined) project.color = parsed.color ?? null
    if (parsed.status !== undefined) project.status = parsed.status
    if (parsed.ownerUserId !== undefined) project.ownerUserId = parsed.ownerUserId ?? null
    if (parsed.costCenter !== undefined) project.costCenter = parsed.costCenter ?? null
    if (parsed.startDate !== undefined) project.startDate = parsed.startDate ?? null
    if (parsed.hourlyRate !== undefined) project.hourlyRate = parsed.hourlyRate ?? null
    if (parsed.billableByDefault !== undefined) project.billableByDefault = parsed.billableByDefault
    if (parsed.budgetKind !== undefined) project.budgetKind = parsed.budgetKind
    if (parsed.budgetValue !== undefined) project.budgetValue = parsed.budgetValue ?? null
    if (parsed.budgetWarnAtPercent !== undefined) project.budgetWarnAtPercent = parsed.budgetWarnAtPercent
    // `currency_code` is intentionally absent here and from the update schema:
    // D-3 gives that column to `staff.timesheets.time_projects.change_currency`,
    // which owns the acknowledgement and the locked-entry refusal. A caller that
    // smuggles `currencyCode` into a PUT has it stripped by the schema, so there
    // is no key to assign from.
    project.updatedAt = new Date()
    try {
      await em.flush()
    } catch (err) {
      if (isUniqueViolation(err)) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          error: translate('staff.timesheets.errors.projectCodeDuplicate', 'A project with this code already exists.'),
          fieldErrors: { code: translate('staff.timesheets.errors.projectCodeDuplicate', 'A project with this code already exists.') },
        })
      }
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: project,
      identifiers: {
        id: project.id,
        organizationId: project.organizationId,
        tenantId: project.tenantId,
      },
      events: staffTimeProjectCrudEvents,
      indexer: timeProjectCrudIndexer,
    })

    return { timeProjectId: project.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TimeProjectSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTimeProjectSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'name',
      'customerId',
      'code',
      'description',
      'projectType',
      'color',
      'status',
      'ownerUserId',
      'costCenter',
      'startDate',
      'hourlyRate',
      'billableByDefault',
      'budgetKind',
      'budgetValue',
      'budgetWarnAtPercent',
      'deletedAt',
    ])
    // `buildChanges` compares by identity, and the two snapshots are loaded through
    // separate forks, so the denormalized customer snapshot needs a value compare
    // or every edit would report it as changed.
    if (JSON.stringify(before.customerSnapshot ?? null) !== JSON.stringify(after.customerSnapshot ?? null)) {
      changes.customerSnapshot = { from: before.customerSnapshot ?? null, to: after.customerSnapshot ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_projects.update', 'Update time project'),
      resourceKind: 'staff.timesheets.time_project',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
        } satisfies TimeProjectUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeProjectUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const project = await em.findOne(StaffTimeProject, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!project) return
    project.name = before.name
    project.customerId = before.customerId ?? null
    project.customerSnapshot = before.customerSnapshot ?? null
    project.code = before.code
    project.description = before.description ?? null
    project.projectType = before.projectType ?? null
    project.color = before.color ?? null
    project.status = (before.status ?? 'active') as StaffTimeProjectStatus
    project.ownerUserId = before.ownerUserId ?? null
    project.costCenter = before.costCenter ?? null
    project.startDate = before.startDate ? new Date(before.startDate) : null
    project.hourlyRate = before.hourlyRate ?? null
    project.billableByDefault = before.billableByDefault ?? true
    project.budgetKind = (before.budgetKind ?? 'none') as StaffTimeProjectBudgetKind
    project.budgetValue = before.budgetValue ?? null
    project.budgetWarnAtPercent = before.budgetWarnAtPercent ?? DEFAULT_BUDGET_WARN_AT_PERCENT
    // Undo of a plain update restores what a plain update could change; the currency
    // stays where change_currency left it (D-3).
    project.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    project.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: project,
      identifiers: {
        id: project.id,
        organizationId: project.organizationId,
        tenantId: project.tenantId,
      },
      events: staffTimeProjectCrudEvents,
      indexer: timeProjectCrudIndexer,
    })
  },
}

const deleteTimeProjectCommand: CommandHandler<{ id?: string }, { timeProjectId: string }> = {
  id: 'staff.timesheets.time_projects.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time project id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTimeProjectSnapshot(em, id, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time project id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const project = await findOneWithDecryption(
      em,
      StaffTimeProject,
      applyScopeToWhere<StaffTimeProject>({ id, deletedAt: null }, scope),
      undefined,
      scopeForDecryption(scope),
    )
    if (!project) throw new CrudHttpError(404, { error: 'Time project not found.' })
    ensureTenantScope(ctx, project.tenantId)
    ensureOrganizationScope(ctx, project.organizationId)

    project.deletedAt = new Date()
    project.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: project,
      identifiers: {
        id: project.id,
        organizationId: project.organizationId,
        tenantId: project.tenantId,
      },
      events: staffTimeProjectCrudEvents,
      indexer: timeProjectCrudIndexer,
    })
    return { timeProjectId: project.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TimeProjectSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_projects.delete', 'Delete time project'),
      resourceKind: 'staff.timesheets.time_project',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies TimeProjectUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeProjectUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let project = await em.findOne(StaffTimeProject, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!project) {
      project = em.create(StaffTimeProject, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        name: before.name,
        customerId: before.customerId ?? null,
        customerSnapshot: before.customerSnapshot ?? null,
        code: before.code,
        description: before.description ?? null,
        projectType: before.projectType ?? null,
        status: (before.status ?? 'active') as StaffTimeProjectStatus,
        ownerUserId: before.ownerUserId ?? null,
        costCenter: before.costCenter ?? null,
        startDate: before.startDate ? new Date(before.startDate) : null,
        hourlyRate: before.hourlyRate ?? null,
        currencyCode: before.currencyCode ?? null,
        billableByDefault: before.billableByDefault ?? true,
        budgetKind: (before.budgetKind ?? 'none') as StaffTimeProjectBudgetKind,
        budgetValue: before.budgetValue ?? null,
        budgetWarnAtPercent: before.budgetWarnAtPercent ?? DEFAULT_BUDGET_WARN_AT_PERCENT,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(project)
    } else {
      project.name = before.name
      project.customerId = before.customerId ?? null
      project.customerSnapshot = before.customerSnapshot ?? null
      project.code = before.code
      project.description = before.description ?? null
      project.projectType = before.projectType ?? null
      project.status = (before.status ?? 'active') as StaffTimeProjectStatus
      project.ownerUserId = before.ownerUserId ?? null
      project.costCenter = before.costCenter ?? null
      project.startDate = before.startDate ? new Date(before.startDate) : null
      project.hourlyRate = before.hourlyRate ?? null
      project.currencyCode = before.currencyCode ?? null
      project.billableByDefault = before.billableByDefault ?? true
      project.budgetKind = (before.budgetKind ?? 'none') as StaffTimeProjectBudgetKind
      project.budgetValue = before.budgetValue ?? null
      project.budgetWarnAtPercent = before.budgetWarnAtPercent ?? DEFAULT_BUDGET_WARN_AT_PERCENT
      project.deletedAt = null
      project.updatedAt = new Date()
    }
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: project,
      identifiers: {
        id: project.id,
        organizationId: project.organizationId,
        tenantId: project.tenantId,
      },
      events: staffTimeProjectCrudEvents,
      indexer: timeProjectCrudIndexer,
    })
  },
}

/**
 * D-3: a project's currency is read-only once hours have been logged against it,
 * and the deliberate change action below relabels the project WITHOUT converting
 * any historical amount. It never touches an entry's `rate_currency_code` or its
 * stored cost, so a closed report keeps billing what it billed. That is also why
 * the change is refused outright while any entry of the project sits frozen in a
 * closed report: relabelling then would make the project disagree with the
 * `frozen_currency_code` those report lines were issued under.
 */
export const staffTimeProjectChangeCurrencyCommandId = 'staff.timesheets.time_projects.change_currency'

export const PROJECT_HAS_LOCKED_ENTRIES_CODE = 'project_has_locked_entries'

const changeTimeProjectCurrencyCommandSchema = staffTimeProjectChangeCurrencySchema.extend({
  id: z.string().uuid(),
})

export type StaffTimeProjectChangeCurrencyCommandInput = z.infer<typeof changeTimeProjectCurrencyCommandSchema>

export type StaffTimeProjectChangeCurrencyResult = {
  timeProjectId: string
  currencyCode: string
  previousCurrencyCode: string | null
}

type BlockingLockedReport = {
  id: string
  reference: string | null
  title: string | null
}

type LockedEntryBlock = {
  lockedEntryCount: number
  reports: BlockingLockedReport[]
}

async function findLockedEntryBlock(
  em: EntityManager,
  project: StaffTimeProject,
): Promise<LockedEntryBlock> {
  const scope = { tenantId: project.tenantId, organizationId: project.organizationId }
  const lockedEntries = await em.find(
    StaffTimeEntry,
    { ...scope, timeProjectId: project.id, lockedReportId: { $ne: null }, deletedAt: null },
    { fields: ['id', 'lockedReportId'] },
  )
  if (lockedEntries.length === 0) return { lockedEntryCount: 0, reports: [] }

  const reportIds = Array.from(
    new Set(lockedEntries.map((entry) => entry.lockedReportId).filter((value): value is string => typeof value === 'string')),
  )
  const reports = reportIds.length
    ? await em.find(
        StaffTimeReport,
        { ...scope, id: { $in: reportIds } },
        { fields: ['id', 'reference', 'title'] },
      )
    : []
  const known = new Map(reports.map((report) => [report.id, report]))

  return {
    lockedEntryCount: lockedEntries.length,
    reports: reportIds.map((id) => ({
      id,
      reference: known.get(id)?.reference ?? null,
      title: known.get(id)?.title ?? null,
    })),
  }
}

async function assertNoLockedEntries(em: EntityManager, project: StaffTimeProject): Promise<void> {
  const block = await findLockedEntryBlock(em, project)
  if (block.lockedEntryCount === 0) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    code: PROJECT_HAS_LOCKED_ENTRIES_CODE,
    error: translate(
      'staff.timesheets.errors.projectCurrencyLocked',
      'This project has time entries frozen in a closed report. Unlock those reports before changing the currency.',
    ),
    lockedEntryCount: block.lockedEntryCount,
    lockedReports: block.reports,
  })
}

/**
 * Same `staff.timesheets.time_project.updated` event id every project write emits,
 * with the currency transition carried in the payload so a subscriber can tell a
 * relabel apart from an ordinary field edit without re-reading the project.
 */
function timeProjectCurrencyChangeEvents(
  previousCurrencyCode: string | null,
  currencyCode: string,
): CrudEventsConfig<StaffTimeProject> {
  return {
    ...staffTimeProjectCrudEvents,
    buildPayload: (emitCtx) => ({
      id: emitCtx.identifiers.id,
      organizationId: emitCtx.identifiers.organizationId,
      tenantId: emitCtx.identifiers.tenantId,
      changedField: 'currencyCode',
      previousCurrencyCode,
      currencyCode,
      converted: false,
    }),
  }
}

const changeTimeProjectCurrencyCommand: CommandHandler<
  StaffTimeProjectChangeCurrencyCommandInput,
  StaffTimeProjectChangeCurrencyResult
> = {
  id: staffTimeProjectChangeCurrencyCommandId,
  async prepare(rawInput, ctx) {
    const parsed = changeTimeProjectCurrencyCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadTimeProjectSnapshot(em, parsed.id, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = changeTimeProjectCurrencyCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const project = await findOneWithDecryption(
      em,
      StaffTimeProject,
      applyScopeToWhere<StaffTimeProject>({ id: parsed.id, deletedAt: null }, scope),
      undefined,
      scopeForDecryption(scope),
    )
    if (!project) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, {
        error: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
      })
    }
    ensureTenantScope(ctx, project.tenantId)
    ensureOrganizationScope(ctx, project.organizationId)

    const previousCurrencyCode = project.currencyCode ?? null

    // The lock probe and the relabel are separate phases of one transaction: the
    // probe queries `staff_time_entries` and must therefore never share a phase
    // with the scalar mutation, and the shared transaction keeps a report closing
    // concurrently from slipping between the check and the write.
    await withAtomicFlush(
      em,
      [
        () => assertNoLockedEntries(em, project),
        () => {
          project.currencyCode = parsed.currencyCode
          project.updatedAt = new Date()
        },
      ],
      { transaction: true, label: staffTimeProjectChangeCurrencyCommandId },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: project,
      identifiers: {
        id: project.id,
        organizationId: project.organizationId,
        tenantId: project.tenantId,
      },
      events: timeProjectCurrencyChangeEvents(previousCurrencyCode, parsed.currencyCode),
      indexer: timeProjectCrudIndexer,
    })

    return {
      timeProjectId: project.id,
      currencyCode: parsed.currencyCode,
      previousCurrencyCode,
    }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TimeProjectSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTimeProjectSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const changes = buildChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      ['currencyCode'],
    )
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_projects.change_currency', 'Change time project currency'),
      resourceKind: 'staff.timesheets.time_project',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
        } satisfies TimeProjectUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeProjectUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const project = await em.findOne(StaffTimeProject, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!project) return

    // Undo relabels back, so it has to honour the same invariant: entries may have
    // been frozen into a closed report since the change was made.
    await withAtomicFlush(
      em,
      [
        () => assertNoLockedEntries(em, project),
        () => {
          project.currencyCode = before.currencyCode ?? null
          project.updatedAt = new Date()
        },
      ],
      { transaction: true, label: `${staffTimeProjectChangeCurrencyCommandId}.undo` },
    )

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: project,
      identifiers: {
        id: project.id,
        organizationId: project.organizationId,
        tenantId: project.tenantId,
      },
      events: staffTimeProjectCrudEvents,
      indexer: timeProjectCrudIndexer,
    })
  },
}

const assignTimeProjectMemberCommand: CommandHandler<StaffTimeProjectMemberAssignInput, { timeProjectMemberId: string }> = {
  id: 'staff.timesheets.time_project_members.assign',
  async execute(rawInput, ctx) {
    const parsed = staffTimeProjectMemberAssignSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Validate referenced project and staff member are in-scope before persisting.
    // Without this check a foreign or stale UUID would produce a dangling reference.
    const projectExists = await em.findOne(
      StaffTimeProject,
      applyScopeToWhere<StaffTimeProject>({ id: parsed.timeProjectId, deletedAt: null }, scope),
      { fields: ['id'] },
    )
    if (!projectExists) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, {
        error: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
        fieldErrors: {
          timeProjectId: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
        },
      })
    }
    const memberExists = await em.findOne(
      StaffTeamMember,
      applyScopeToWhere<StaffTeamMember>({ id: parsed.staffMemberId, deletedAt: null }, scope),
      { fields: ['id'] },
    )
    if (!memberExists) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, {
        error: translate('staff.timesheets.errors.staffMemberNotFound', 'Staff member not found or not accessible.'),
        fieldErrors: {
          staffMemberId: translate('staff.timesheets.errors.staffMemberNotFound', 'Staff member not found or not accessible.'),
        },
      })
    }

    const now = new Date()
    const member = em.create(StaffTimeProjectMember, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      timeProjectId: parsed.timeProjectId,
      staffMemberId: parsed.staffMemberId,
      role: parsed.role ?? null,
      status: parsed.status ?? 'active',
      showInGrid: false,
      assignedStartDate: parsed.assignedStartDate,
      assignedEndDate: parsed.assignedEndDate ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(member)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: member,
      identifiers: { id: member.id, organizationId: member.organizationId, tenantId: member.tenantId },
      events: staffTimeProjectMemberCrudEvents,
      indexer: timeProjectMemberCrudIndexer,
    })

    return { timeProjectMemberId: member.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeProjectMemberSnapshot(em, result.timeProjectMemberId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeProjectMemberSnapshot(em, result.timeProjectMemberId, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_project_members.assign', 'Assign time project member'),
      resourceKind: 'staff.timesheets.time_project_member',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies TimeProjectMemberUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeProjectMemberUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await em.findOne(StaffTimeProjectMember, scopedStaffSnapshotWhere(after.id, staffSnapshotScopeFromSnapshot(after)))
    if (member) {
      member.deletedAt = new Date()
      await em.flush()

      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: member,
        identifiers: { id: member.id, organizationId: member.organizationId, tenantId: member.tenantId },
        events: staffTimeProjectMemberCrudEvents,
      })
    }
  },
  redo: makeCreateRedo<StaffTimeProjectMember, TimeProjectMemberSnapshot, StaffTimeProjectMemberAssignInput, { timeProjectMemberId: string }>({
    entityClass: StaffTimeProjectMember,
    getSnapshotId: (snapshot) => snapshot.id,
    seedFromSnapshot: timeProjectMemberSeedFromSnapshot,
    buildResult: (entity) => ({ timeProjectMemberId: entity.id }),
    events: staffTimeProjectMemberCrudEvents,
    indexer: timeProjectMemberCrudIndexer,
  }),
}

/**
 * D-12 turned `assigned_end_date` into a field a Team Leader edits, so a
 * membership row needs an update path of its own. Without one the project team
 * drawer had to express a re-dating as "assign a replacement row, drop the old
 * one", and the audit trail then read as an unassign plus an assign — a history
 * that misstates what happened on the record an invoice is defended with.
 *
 * `timeProjectId` is optional in the schema but always supplied by the route
 * from the URL segment: the membership must belong to the project being edited,
 * so a body carrying a foreign membership id cannot reach another project's row.
 */
const updateTimeProjectMemberCommandSchema = staffTimeProjectMemberUpdateSchema.extend({
  timeProjectId: z.string().uuid().optional(),
})

export type StaffTimeProjectMemberUpdateCommandInput = StaffTimeProjectMemberUpdateInput & {
  timeProjectId?: string
}

const updateTimeProjectMemberCommand: CommandHandler<StaffTimeProjectMemberUpdateCommandInput, { timeProjectMemberId: string }> = {
  id: 'staff.timesheets.time_project_members.update',
  async prepare(rawInput, ctx) {
    const parsed = updateTimeProjectMemberCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadTimeProjectMemberSnapshot(em, parsed.id, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = updateTimeProjectMemberCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const member = await findOneWithDecryption(
      em,
      StaffTimeProjectMember,
      applyScopeToWhere<StaffTimeProjectMember>(
        {
          id: parsed.id,
          deletedAt: null,
          ...(parsed.timeProjectId ? { timeProjectId: parsed.timeProjectId } : {}),
        },
        scope,
      ),
      undefined,
      scopeForDecryption(scope),
    )
    if (!member) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, {
        error: translate('staff.timesheets.errors.memberNotFound', 'Time project member not found or not accessible.'),
      })
    }
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    if (parsed.role !== undefined) member.role = parsed.role ?? null
    if (parsed.status !== undefined) member.status = parsed.status
    if (parsed.assignedEndDate !== undefined) member.assignedEndDate = parsed.assignedEndDate ?? null
    member.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: member,
      identifiers: { id: member.id, organizationId: member.organizationId, tenantId: member.tenantId },
      events: staffTimeProjectMemberCrudEvents,
      indexer: timeProjectMemberCrudIndexer,
    })

    return { timeProjectMemberId: member.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TimeProjectMemberSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTimeProjectMemberSnapshot(em, before.id, staffSnapshotScopeFromSnapshot(before))
    if (!after) return null
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'role',
      'status',
      'assignedEndDate',
    ])
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_project_members.update', 'Update time project member'),
      resourceKind: 'staff.timesheets.time_project_member',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
        } satisfies TimeProjectMemberUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeProjectMemberUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await em.findOne(StaffTimeProjectMember, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!member) return
    // Restores exactly what this command can change; the assignment window's
    // start and the row's identity belong to assign/unassign.
    member.role = before.role ?? null
    member.status = (before.status ?? 'active') as StaffTimeProjectMemberStatus
    member.assignedEndDate = before.assignedEndDate ? new Date(before.assignedEndDate) : null
    member.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: member,
      identifiers: { id: member.id, organizationId: member.organizationId, tenantId: member.tenantId },
      events: staffTimeProjectMemberCrudEvents,
      indexer: timeProjectMemberCrudIndexer,
    })
  },
}

const unassignTimeProjectMemberCommand: CommandHandler<{ id?: string }, { timeProjectMemberId: string }> = {
  id: 'staff.timesheets.time_project_members.unassign',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time project member id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTimeProjectMemberSnapshot(em, id, staffSnapshotScopeFromContext(ctx))
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time project member id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const member = await findOneWithDecryption(
      em,
      StaffTimeProjectMember,
      applyScopeToWhere<StaffTimeProjectMember>({ id, deletedAt: null }, scope),
      undefined,
      scopeForDecryption(scope),
    )
    if (!member) throw new CrudHttpError(404, { error: 'Time project member not found.' })
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    member.deletedAt = new Date()
    member.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: member,
      identifiers: { id: member.id, organizationId: member.organizationId, tenantId: member.tenantId },
      events: staffTimeProjectMemberCrudEvents,
      indexer: timeProjectMemberCrudIndexer,
    })

    return { timeProjectMemberId: member.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TimeProjectMemberSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_project_members.unassign', 'Unassign time project member'),
      resourceKind: 'staff.timesheets.time_project_member',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies TimeProjectMemberUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeProjectMemberUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let member = await em.findOne(StaffTimeProjectMember, scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)))
    if (!member) {
      member = em.create(StaffTimeProjectMember, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        timeProjectId: before.timeProjectId,
        staffMemberId: before.staffMemberId,
        role: before.role ?? null,
        status: (before.status ?? 'active') as StaffTimeProjectMemberStatus,
        showInGrid: before.showInGrid ?? false,
        assignedStartDate: new Date(before.assignedStartDate),
        assignedEndDate: before.assignedEndDate ? new Date(before.assignedEndDate) : null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(member)
    } else {
      member.timeProjectId = before.timeProjectId
      member.staffMemberId = before.staffMemberId
      member.role = before.role ?? null
      member.status = (before.status ?? 'active') as StaffTimeProjectMemberStatus
      member.assignedStartDate = new Date(before.assignedStartDate)
      member.assignedEndDate = before.assignedEndDate ? new Date(before.assignedEndDate) : null
      member.deletedAt = null
      member.updatedAt = new Date()
    }
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: member,
      identifiers: { id: member.id, organizationId: member.organizationId, tenantId: member.tenantId },
      events: staffTimeProjectMemberCrudEvents,
      indexer: timeProjectMemberCrudIndexer,
    })
  },
}

registerCommand(createTimeProjectCommand)
registerCommand(updateTimeProjectCommand)
registerCommand(deleteTimeProjectCommand)
registerCommand(changeTimeProjectCurrencyCommand)
registerCommand(assignTimeProjectMemberCommand)
registerCommand(updateTimeProjectMemberCommand)
registerCommand(unassignTimeProjectMemberCommand)
