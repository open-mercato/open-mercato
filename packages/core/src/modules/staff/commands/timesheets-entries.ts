import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { StaffTimeEntry } from '../data/entities'
import {
  staffTimeEntryCreateSchema,
  staffTimeEntryUpdateSchema,
  type StaffTimeEntryCreateInput,
  type StaffTimeEntryUpdateInput,
} from '../data/validators'
import { staffTimeEntryCrudEvents } from '../lib/crud'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'

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

const createTimeEntryCommand: CommandHandler<StaffTimeEntryCreateInput, { timeEntryId: string }> = {
  id: 'staff.timesheets.time_entries.create',
  async execute(rawInput, ctx) {
    const parsed = staffTimeEntryCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const entry = em.create(StaffTimeEntry, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      staffMemberId: parsed.staffMemberId,
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

    entry.deletedAt = new Date()
    entry.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'deleted',
      entity: entry,
      identifiers: { id: entry.id, organizationId: entry.organizationId, tenantId: entry.tenantId },
      events: staffTimeEntryCrudEvents,
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
        source: before.source,
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
      entry.source = before.source
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
    })
  },
}

registerCommand(createTimeEntryCommand)
registerCommand(updateTimeEntryCommand)
registerCommand(deleteTimeEntryCommand)
