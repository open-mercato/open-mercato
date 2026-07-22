import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StaffTeamMember, StaffTimeProject, StaffTimeProjectMember, type StaffTimeProjectStatus, type StaffTimeProjectMemberStatus } from '../data/entities'

const timeProjectCrudIndexer: CrudIndexerConfig<StaffTimeProject> = {
  entityType: 'staff:staff_time_project',
}
const timeProjectMemberCrudIndexer: CrudIndexerConfig<StaffTimeProjectMember> = {
  entityType: 'staff:staff_time_project_member',
}
import {
  staffTimeProjectCreateSchema,
  staffTimeProjectUpdateSchema,
  staffTimeProjectMemberAssignSchema,
  staffTimeProjectMemberUpdateSchema,
  type StaffTimeProjectCreateInput,
  type StaffTimeProjectUpdateInput,
  type StaffTimeProjectMemberAssignInput,
  type StaffTimeProjectMemberUpdateInput,
} from '../data/validators'
import { staffTimeProjectCrudEvents, staffTimeProjectMemberCrudEvents } from '../lib/crud'
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
  code: string
  description: string | null
  projectType: string | null
  color: string | null
  status: string
  ownerUserId: string | null
  costCenter: string | null
  startDate: string | null
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
    code: project.code,
    description: project.description ?? null,
    projectType: project.projectType ?? null,
    color: project.color ?? null,
    status: project.status,
    ownerUserId: project.ownerUserId ?? null,
    costCenter: project.costCenter ?? null,
    startDate: project.startDate instanceof Date ? project.startDate.toISOString().split('T')[0] : (project.startDate ?? null),
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
    code: snapshot.code,
    description: snapshot.description ?? null,
    projectType: snapshot.projectType ?? null,
    color: snapshot.color ?? null,
    status: (snapshot.status ?? 'active') as StaffTimeProjectStatus,
    ownerUserId: snapshot.ownerUserId ?? null,
    costCenter: snapshot.costCenter ?? null,
    startDate: snapshot.startDate ? new Date(snapshot.startDate) : null,
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
      customerId: parsed.customerId ?? null,
      code: parsed.code,
      description: parsed.description ?? null,
      projectType: parsed.projectType ?? null,
      color: parsed.color ?? null,
      status: parsed.status ?? 'active',
      ownerUserId: parsed.ownerUserId ?? null,
      costCenter: parsed.costCenter ?? null,
      startDate: parsed.startDate ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(project)
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
    if (parsed.code !== undefined) project.code = parsed.code
    if (parsed.description !== undefined) project.description = parsed.description ?? null
    if (parsed.projectType !== undefined) project.projectType = parsed.projectType ?? null
    if (parsed.color !== undefined) project.color = parsed.color ?? null
    if (parsed.status !== undefined) project.status = parsed.status
    if (parsed.ownerUserId !== undefined) project.ownerUserId = parsed.ownerUserId ?? null
    if (parsed.costCenter !== undefined) project.costCenter = parsed.costCenter ?? null
    if (parsed.startDate !== undefined) project.startDate = parsed.startDate ?? null
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
      'deletedAt',
    ])
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
    project.code = before.code
    project.description = before.description ?? null
    project.projectType = before.projectType ?? null
    project.color = before.color ?? null
    project.status = (before.status ?? 'active') as StaffTimeProjectStatus
    project.ownerUserId = before.ownerUserId ?? null
    project.costCenter = before.costCenter ?? null
    project.startDate = before.startDate ? new Date(before.startDate) : null
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
        code: before.code,
        description: before.description ?? null,
        projectType: before.projectType ?? null,
        status: (before.status ?? 'active') as StaffTimeProjectStatus,
        ownerUserId: before.ownerUserId ?? null,
        costCenter: before.costCenter ?? null,
        startDate: before.startDate ? new Date(before.startDate) : null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(project)
    } else {
      project.name = before.name
      project.customerId = before.customerId ?? null
      project.code = before.code
      project.description = before.description ?? null
      project.projectType = before.projectType ?? null
      project.status = (before.status ?? 'active') as StaffTimeProjectStatus
      project.ownerUserId = before.ownerUserId ?? null
      project.costCenter = before.costCenter ?? null
      project.startDate = before.startDate ? new Date(before.startDate) : null
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
registerCommand(assignTimeProjectMemberCommand)
registerCommand(unassignTimeProjectMemberCommand)
