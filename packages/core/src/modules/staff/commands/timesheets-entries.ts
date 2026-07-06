import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StaffTimeEntry, StaffTimeEntrySegment, StaffTimeProject, type StaffTimeEntrySource } from '../data/entities'
import { emitStaffEvent } from '../events'

const timeEntryCrudIndexer: CrudIndexerConfig<StaffTimeEntry> = {
  entityType: 'staff:staff_time_entry',
}
import {
  staffTimeEntryCreateSchema,
  staffTimeEntryStartTimerSchema,
  staffTimeEntryUpdateSchema,
  type StaffTimeEntryCreateInput,
  type StaffTimeEntryStartTimerInput,
  type StaffTimeEntryUpdateInput,
} from '../data/validators'
import { staffTimeEntryCrudEvents } from '../lib/crud'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { getStaffMemberByUserId } from '../lib/staffMemberResolver'

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

/**
 * Returns true when the caller holds `staff.timesheets.manage_all`, honoring
 * wildcard ACL grants (`staff.*`, `*`) and the super-admin flag via the cached
 * rbacService. Returns false when no auth context (e.g. system/CLI ctx) so
 * write paths that lack a caller identity are NOT silently elevated.
 */
async function callerHasManageAll(ctx: {
  auth?: { sub?: string | null; tenantId?: string | null; orgId?: string | null } | null
  container: { resolve: (token: string) => unknown }
}): Promise<boolean> {
  const userId = ctx.auth?.sub
  if (!userId) return false
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.userHasAllFeatures) return false
    return await rbac.userHasAllFeatures(
      userId,
      ['staff.timesheets.manage_all'],
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
  } catch {
    return false
  }
}

async function resolveCallerStaffMemberId(
  em: EntityManager,
  ctx: { auth?: { sub?: string | null; tenantId?: string | null; orgId?: string | null } | null },
): Promise<string | null> {
  const userId = ctx.auth?.sub
  if (!userId) return null
  const member = await getStaffMemberByUserId(
    em,
    userId,
    ctx.auth?.tenantId ?? null,
    ctx.auth?.orgId ?? null,
  )
  return member?.id ?? null
}

/**
 * Verifies the referenced time project exists and is in-scope (same tenant + org,
 * not soft-deleted). Throws 422 if the ID is provided but unresolvable.
 * No-op when projectId is null/undefined (timeProjectId is optional on entries).
 */
async function assertTimeProjectInScope(
  em: EntityManager,
  projectId: string | null | undefined,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  if (!projectId) return
  const exists = await em.findOne(
    StaffTimeProject,
    { id: projectId, tenantId, organizationId, deletedAt: null },
    { fields: ['id'] },
  )
  if (!exists) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(422, {
      error: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
      fieldErrors: {
        timeProjectId: translate('staff.timesheets.errors.projectNotFound', 'Time project not found or not accessible.'),
      },
    })
  }
}

type TimeEntrySnapshot = {
  id: string
  tenantId: string
  organizationId: string
  staffMemberId: string
  date: string
  durationMinutes: number
  startedAt: string | null
  endedAt: string | null
  notes: string | null
  timeProjectId: string | null
  customerId: string | null
  dealId: string | null
  orderId: string | null
  source: string
  deletedAt: string | null
}

type TimeEntryUndoPayload = {
  before?: TimeEntrySnapshot | null
  after?: TimeEntrySnapshot | null
}

async function loadTimeEntrySnapshot(em: EntityManager, id: string): Promise<TimeEntrySnapshot | null> {
  const entry = await findOneWithDecryption(em, StaffTimeEntry, { id }, undefined, { tenantId: null, organizationId: null })
  if (!entry) return null
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    staffMemberId: entry.staffMemberId,
    date: entry.date instanceof Date ? entry.date.toISOString().split('T')[0] : String(entry.date),
    durationMinutes: entry.durationMinutes,
    startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
    endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
    notes: entry.notes ?? null,
    timeProjectId: entry.timeProjectId ?? null,
    customerId: entry.customerId ?? null,
    dealId: entry.dealId ?? null,
    orderId: entry.orderId ?? null,
    source: entry.source,
    deletedAt: entry.deletedAt ? entry.deletedAt.toISOString() : null,
  }
}

function timeEntrySeedFromSnapshot(snapshot: TimeEntrySnapshot): Record<string, unknown> {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
    staffMemberId: snapshot.staffMemberId,
    date: snapshot.date,
    durationMinutes: snapshot.durationMinutes,
    startedAt: snapshot.startedAt ? new Date(snapshot.startedAt) : null,
    endedAt: snapshot.endedAt ? new Date(snapshot.endedAt) : null,
    notes: snapshot.notes ?? null,
    timeProjectId: snapshot.timeProjectId ?? null,
    customerId: snapshot.customerId ?? null,
    dealId: snapshot.dealId ?? null,
    orderId: snapshot.orderId ?? null,
    source: (snapshot.source ?? 'manual') as StaffTimeEntrySource,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

const createTimeEntryCommand: CommandHandler<StaffTimeEntryCreateInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.create',
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Ownership enforcement: callers without `staff.timesheets.manage_all`
    // can only create entries attributed to themselves. Silent override
    // (mirrors `bulk/route.ts` behavior) so the request body's staffMemberId
    // can't forge an entry under a colleague's identity.
    let effectiveStaffMemberId = parsed.staffMemberId
    if (!(await callerHasManageAll(ctx))) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
        })
      }
      effectiveStaffMemberId = callerStaffMemberId
    }

    // Validate referenced timeProjectId is in-scope before persisting.
    // Without this check a foreign or stale UUID would produce a dangling reference.
    await assertTimeProjectInScope(em, parsed.timeProjectId ?? null, parsed.tenantId, parsed.organizationId)

    const now = new Date()
    const entry = em.create(StaffTimeEntry, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      staffMemberId: effectiveStaffMemberId,
      date: parsed.date,
      durationMinutes: parsed.durationMinutes,
      startedAt: parsed.startedAt ?? null,
      endedAt: parsed.endedAt ?? null,
      notes: parsed.notes ?? null,
      timeProjectId: parsed.timeProjectId ?? null,
      customerId: parsed.customerId ?? null,
      dealId: parsed.dealId ?? null,
      orderId: parsed.orderId ?? null,
      source: parsed.source ?? 'manual',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(entry)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    return { timeEntryId: entry.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId)
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId)
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.create', 'Create time entry'),
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(StaffTimeEntry, { id: after.id })
    if (entry) {
      entry.deletedAt = new Date()
      await em.flush()

      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: entry,
        identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
        events: staffTimeEntryCrudEvents,
      })
    }
  },
  redo: makeCreateRedo<StaffTimeEntry, TimeEntrySnapshot, StaffTimeEntryCreateInput, { timeEntryId: string }>({
    entityClass: StaffTimeEntry,
    getSnapshotId: (snapshot) => snapshot.id,
    seedFromSnapshot: timeEntrySeedFromSnapshot,
    buildResult: (entity) => ({ timeEntryId: entity.id }),
    events: staffTimeEntryCrudEvents,
    indexer: timeEntryCrudIndexer,
  }),
}

const startTimerCommand: CommandHandler<StaffTimeEntryStartTimerInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.start_timer',
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryStartTimerSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Ownership enforcement mirrors createTimeEntryCommand: callers without
    // `staff.timesheets.manage_all` can only start their own timer, so the
    // request body's staffMemberId can't start a timer under a colleague's id.
    let effectiveStaffMemberId = parsed.staffMemberId
    if (!(await callerHasManageAll(ctx))) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
        })
      }
      effectiveStaffMemberId = callerStaffMemberId
    }

    await assertTimeProjectInScope(em, parsed.timeProjectId ?? null, parsed.tenantId, parsed.organizationId)

    const scopeCtx = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }

    // Create the timer entry AND start it inside a single transaction so a
    // partial failure can never leave an orphaned, never-started timer entry
    // (issue #3311 — the legacy two-request create-then-start flow). The
    // single-active-timer invariant (#2855) is re-checked here so a second
    // surface cannot create a parallel running timer for the same staff member.
    const { entry, startedAt } = await em.transactional(async (trx) => {
      const otherRunningEntry = await findOneWithDecryption(
        trx,
        StaffTimeEntry,
        {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          staffMemberId: effectiveStaffMemberId,
          startedAt: { $ne: null },
          endedAt: null,
          deletedAt: null,
        },
        {},
        scopeCtx,
      )
      if (otherRunningEntry) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          error: translate(
            'staff.timesheets.errors.timerAlreadyRunning',
            'Another timer is already running. Stop it before starting a new one.',
          ),
        })
      }

      const startedAt = new Date()
      const entry = trx.create(StaffTimeEntry, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        staffMemberId: effectiveStaffMemberId,
        date: parsed.date,
        durationMinutes: 0,
        startedAt,
        endedAt: null,
        notes: parsed.notes ?? null,
        timeProjectId: parsed.timeProjectId ?? null,
        customerId: null,
        dealId: null,
        orderId: null,
        source: 'timer',
        createdAt: startedAt,
        updatedAt: startedAt,
        deletedAt: null,
      })
      // Flush so the DB-generated id is populated before the work segment
      // references it; both writes commit together when the transaction closes.
      await trx.flush()

      const segmentData = {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        timeEntryId: entry.id,
        startedAt,
        segmentType: 'work' as const,
      }
      trx.create(StaffTimeEntrySegment, segmentData as never)
      await trx.flush()

      return { entry, startedAt }
    })

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    void emitStaffEvent('staff.timesheets.time_entry.timer_started', {
      id: entry.id,
      staffMemberId: effectiveStaffMemberId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      startedAt: startedAt.toISOString(),
    }, { persistent: true }).catch((err) => {
      console.error('[staff.timesheets] emit timer_started failed', err)
    })

    return { timeEntryId: entry.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId)
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTimeEntrySnapshot(em, result.timeEntryId)
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.startTimer', 'Start timer'),
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(StaffTimeEntry, { id: after.id })
    if (entry) {
      entry.deletedAt = new Date()
      await em.flush()

      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: entry,
        identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
        events: staffTimeEntryCrudEvents,
      })
    }
  },
}

const updateTimeEntryCommand: CommandHandler<StaffTimeEntryUpdateInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTimeEntryUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTimeEntrySnapshot(em, parsed.id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!entry) throw new CrudHttpError(404, { error: 'Time entry not found.' })
    ensureTenantScope(ctx, entry.tenantId)
    ensureOrganizationScope(ctx, entry.organizationId)

    // Ownership enforcement: callers without `staff.timesheets.manage_all`
    // can only update entries they own.
    if (!(await callerHasManageAll(ctx))) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId || entry.staffMemberId !== callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.'),
        })
      }
    }

    // Validate referenced timeProjectId is in-scope when it's being changed to a non-null value.
    if (parsed.timeProjectId !== undefined && parsed.timeProjectId !== null) {
      await assertTimeProjectInScope(em, parsed.timeProjectId, entry.tenantId, entry.organizationId)
    }

    if (parsed.date !== undefined) entry.date = parsed.date
    if (parsed.durationMinutes !== undefined) entry.durationMinutes = parsed.durationMinutes
    if (parsed.timeProjectId !== undefined) entry.timeProjectId = parsed.timeProjectId ?? null
    if (parsed.customerId !== undefined) entry.customerId = parsed.customerId ?? null
    if (parsed.dealId !== undefined) entry.dealId = parsed.dealId ?? null
    if (parsed.orderId !== undefined) entry.orderId = parsed.orderId ?? null
    if (parsed.notes !== undefined) entry.notes = parsed.notes ?? null
    entry.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    return { timeEntryId: entry.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TimeEntrySnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadTimeEntrySnapshot(em, before.id)
    if (!after) return null
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'date',
      'durationMinutes',
      'timeProjectId',
      'customerId',
      'dealId',
      'orderId',
      'notes',
      'deletedAt',
    ])
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.update', 'Update time entry'),
      resourceKind: 'staff.timesheets.time_entry',
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
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(StaffTimeEntry, { id: before.id })
    if (!entry) return
    entry.date = before.date as unknown as Date
    entry.durationMinutes = before.durationMinutes
    entry.timeProjectId = before.timeProjectId ?? null
    entry.customerId = before.customerId ?? null
    entry.dealId = before.dealId ?? null
    entry.orderId = before.orderId ?? null
    entry.notes = before.notes ?? null
    entry.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    entry.updatedAt = new Date()
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })
  },
}

const deleteTimeEntryCommand: CommandHandler<{ id?: string }, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time entry id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTimeEntrySnapshot(em, id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Time entry id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!entry) throw new CrudHttpError(404, { error: 'Time entry not found.' })
    ensureTenantScope(ctx, entry.tenantId)
    ensureOrganizationScope(ctx, entry.organizationId)

    // Ownership enforcement: callers without `staff.timesheets.manage_all`
    // can only delete entries they own.
    if (!(await callerHasManageAll(ctx))) {
      const callerStaffMemberId = await resolveCallerStaffMemberId(em, ctx)
      if (!callerStaffMemberId || entry.staffMemberId !== callerStaffMemberId) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.'),
        })
      }
    }

    entry.deletedAt = new Date()
    entry.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })

    return { timeEntryId: entry.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TimeEntrySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.timesheets.time_entries.delete', 'Delete time entry'),
      resourceKind: 'staff.timesheets.time_entry',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies TimeEntryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TimeEntryUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let entry = await em.findOne(StaffTimeEntry, { id: before.id })
    if (!entry) {
      entry = em.create(StaffTimeEntry, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        staffMemberId: before.staffMemberId,
        date: before.date as unknown as Date,
        durationMinutes: before.durationMinutes,
        startedAt: before.startedAt ? new Date(before.startedAt) : null,
        endedAt: before.endedAt ? new Date(before.endedAt) : null,
        notes: before.notes ?? null,
        timeProjectId: before.timeProjectId ?? null,
        customerId: before.customerId ?? null,
        dealId: before.dealId ?? null,
        orderId: before.orderId ?? null,
        source: (before.source ?? 'manual') as StaffTimeEntrySource,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(entry)
    } else {
      entry.staffMemberId = before.staffMemberId
      entry.date = before.date as unknown as Date
      entry.durationMinutes = before.durationMinutes
      entry.startedAt = before.startedAt ? new Date(before.startedAt) : null
      entry.endedAt = before.endedAt ? new Date(before.endedAt) : null
      entry.notes = before.notes ?? null
      entry.timeProjectId = before.timeProjectId ?? null
      entry.customerId = before.customerId ?? null
      entry.dealId = before.dealId ?? null
      entry.orderId = before.orderId ?? null
      entry.source = (before.source ?? 'manual') as StaffTimeEntrySource
      entry.deletedAt = null
      entry.updatedAt = new Date()
    }
    await em.flush()

    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
      indexer: timeEntryCrudIndexer,
    })
  },
}

registerCommand(createTimeEntryCommand)
registerCommand(startTimerCommand)
registerCommand(updateTimeEntryCommand)
registerCommand(deleteTimeEntryCommand)
