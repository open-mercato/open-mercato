import { randomUUID } from 'crypto'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PlannerAvailabilityRule } from '@open-mercato/core/modules/planner/data/entities'
import { StaffLeaveRequest, type StaffLeaveRequestStatus } from '../data/entities'
import {
  staffLeaveRequestCreateSchema,
  staffLeaveRequestDecisionSchema,
  staffLeaveRequestUpdateSchema,
  type StaffLeaveRequestCreateInput,
  type StaffLeaveRequestDecisionInput,
  type StaffLeaveRequestUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload, requireTeamMember } from './shared'
import { E } from '#generated/entities.ids.generated'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType, buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

const leaveRequestCrudIndexer: CrudIndexerConfig<StaffLeaveRequest> = {
  entityType: E.staff.staff_leave_request,
}

const availabilityRuleCrudIndexer: CrudIndexerConfig<PlannerAvailabilityRule> = {
  entityType: E.planner.planner_availability_rule,
  cacheAliases: ['planner.availability'],
}

type LeaveRequestSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  memberId: string
  startDate: string
  endDate: string
  timezone: string
  status: StaffLeaveRequestStatus
  unavailabilityReasonEntryId: string | null
  unavailabilityReasonValue: string | null
  note: string | null
  decisionComment: string | null
  submittedByUserId: string | null
  decidedByUserId: string | null
  decidedAt: string | null
  deletedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

type LeaveRequestUndoPayload = {
  before?: LeaveRequestSnapshot | null
  after?: LeaveRequestSnapshot | null
  availabilityRuleIds?: string[]
}

function parseUuidCandidate(value: string | null | undefined): string | null {
  if (!value) return null
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
  return uuidRegex.test(value) ? value : null
}

function resolveAuthUserId(ctx: { auth?: { sub?: string | null; isApiKey?: boolean } | null }): string | null {
  if (!ctx.auth || ctx.auth.isApiKey) return null
  return parseUuidCandidate(ctx.auth.sub ?? null)
}

function formatDateKey(value: Date): string {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function listDateKeysInRange(start: Date, end: Date): string[] {
  const dates: string[] = []
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
  while (current <= last) {
    dates.push(formatDateKey(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildAvailabilityRrule(start: Date, end: Date): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:FREQ=DAILY;COUNT=1`
}

function buildFullDayRrule(date: string): string | null {
  const [year, month, day] = date.split('-').map((part) => Number(part))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return buildAvailabilityRrule(start, end)
}

async function loadLeaveRequestSnapshot(em: EntityManager, id: string): Promise<LeaveRequestSnapshot | null> {
  const request = await findOneWithDecryption(em, StaffLeaveRequest, { id }, undefined, { tenantId: null, organizationId: null })
  if (!request) return null
  const memberId = typeof request.member === 'string' ? request.member : request.member.id
  return {
    id: request.id,
    tenantId: request.tenantId,
    organizationId: request.organizationId,
    memberId,
    startDate: request.startDate.toISOString(),
    endDate: request.endDate.toISOString(),
    timezone: request.timezone,
    status: request.status,
    unavailabilityReasonEntryId: request.unavailabilityReasonEntryId ?? null,
    unavailabilityReasonValue: request.unavailabilityReasonValue ?? null,
    note: request.note ?? null,
    decisionComment: request.decisionComment ?? null,
    submittedByUserId: request.submittedByUserId ?? null,
    decidedByUserId: request.decidedByUserId ?? null,
    decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
    deletedAt: request.deletedAt ? request.deletedAt.toISOString() : null,
    createdAt: request.createdAt ? request.createdAt.toISOString() : null,
    updatedAt: request.updatedAt ? request.updatedAt.toISOString() : null,
  }
}

async function requireLeaveRequest(em: EntityManager, id: string): Promise<StaffLeaveRequest> {
  const request = await findOneWithDecryption(em, StaffLeaveRequest, { id, deletedAt: null }, undefined, { tenantId: null, organizationId: null })
  if (!request) throw new CrudHttpError(404, { error: 'Leave request not found.' })
  return request
}

function ensurePendingStatus(request: StaffLeaveRequest): void {
  if (request.status !== 'pending') {
    throw new CrudHttpError(400, { error: 'Leave request is already finalized.' })
  }
}

async function createUnavailabilityRules(params: {
  em: EntityManager
  tenantId: string
  organizationId: string
  memberId: string
  timezone: string
  dates: string[]
  note: string | null
  reasonEntryId: string | null
  reasonValue: string | null
}): Promise<string[]> {
  const now = new Date()
  const createdIds: string[] = []
  params.dates.forEach((date) => {
    const rrule = buildFullDayRrule(date)
    if (!rrule) return
    const ruleId = randomUUID()
    const rule = params.em.create(PlannerAvailabilityRule, {
      id: ruleId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      subjectType: 'member',
      subjectId: params.memberId,
      timezone: params.timezone,
      rrule,
      exdates: [],
      kind: 'unavailability',
      note: params.note,
      unavailabilityReasonEntryId: params.reasonEntryId,
      unavailabilityReasonValue: params.reasonValue,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    params.em.persist(rule)
    createdIds.push(ruleId)
  })
  return createdIds
}

async function invalidateAvailabilityCache(params: {
  container: CommandRuntimeContext['container']
  tenantId: string | null
  organizationId: string | null
  ruleIds: string[]
}) {
  if (!params.ruleIds.length) return
  const resource = 'planner.availability'
  const fallbackTenant = params.tenantId ?? null
  for (const ruleId of params.ruleIds) {
    await invalidateCrudCache(
      params.container,
      resource,
      { id: ruleId, organizationId: params.organizationId, tenantId: params.tenantId },
      fallbackTenant,
      'updated',
    )
  }
}

const createLeaveRequestCommand: CommandHandler<StaffLeaveRequestCreateInput, { requestId: string }> = {
  id: 'staff.leave-requests.create',
  async execute(rawInput, ctx) {
    const parsed = staffLeaveRequestCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await requireTeamMember(em, parsed.memberId, 'Team member not found')
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    const submittedByUserId = parsed.submittedByUserId ?? resolveAuthUserId(ctx)
    const now = new Date()
    const request = em.create(StaffLeaveRequest, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      member,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      timezone: parsed.timezone,
      status: 'pending',
      unavailabilityReasonEntryId: parsed.unavailabilityReasonEntryId ?? null,
      unavailabilityReasonValue: parsed.unavailabilityReasonValue ?? null,
      note: parsed.note ?? null,
      decisionComment: null,
      submittedByUserId,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(request)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })

    // Create notification for users who can approve/reject leave requests
    try {
      const notificationService = resolveNotificationService(ctx.container)
      const typeDef = notificationTypes.find((type) => type.type === 'staff.leave_request.pending')
      if (typeDef) {
        const memberName = member.displayName || 'Team member'
        const startDateStr = request.startDate.toLocaleDateString()
        const endDateStr = request.endDate.toLocaleDateString()

        const notificationInput = buildFeatureNotificationFromType(typeDef, {
          requiredFeature: 'staff.leave_requests.manage',
          bodyVariables: {
            memberName,
            startDate: startDateStr,
            endDate: endDateStr,
          },
          sourceEntityType: 'staff:leave_request',
          sourceEntityId: request.id,
          linkHref: `/backend/staff/leave-requests/${request.id}`,
        })

        await notificationService.createForFeature(notificationInput, {
          tenantId: request.tenantId,
          organizationId: request.organizationId,
        })
      }
    } catch {
      // Notification creation is non-critical, don't fail the command
    }

    return { requestId: request.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadLeaveRequestSnapshot(em, result.requestId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeaveRequestSnapshot(em, result.requestId)
    return {
      actionLabel: translate('staff.audit.leaveRequests.create', 'Create leave request'),
      resourceKind: 'staff.leave_request',
      resourceId: result.requestId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies LeaveRequestUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeaveRequestUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await em.findOne(StaffLeaveRequest, { id: after.id })
    if (request) {
      request.deletedAt = new Date()
      request.updatedAt = new Date()
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: request,
        identifiers: {
          id: request.id,
          organizationId: request.organizationId,
          tenantId: request.tenantId,
        },
        indexer: leaveRequestCrudIndexer,
      })
    }
  },
}

const updateLeaveRequestCommand: CommandHandler<StaffLeaveRequestUpdateInput, { requestId: string }> = {
  id: 'staff.leave-requests.update',
  async prepare(rawInput, ctx) {
    const parsed = staffLeaveRequestUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeaveRequestSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffLeaveRequestUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await requireLeaveRequest(em, parsed.id)
    ensureTenantScope(ctx, request.tenantId)
    ensureOrganizationScope(ctx, request.organizationId)
    ensurePendingStatus(request)

    if (parsed.memberId !== undefined) {
      const member = await requireTeamMember(em, parsed.memberId, 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      request.member = member
    }
    if (parsed.startDate !== undefined) request.startDate = parsed.startDate
    if (parsed.endDate !== undefined) request.endDate = parsed.endDate
    if (parsed.timezone !== undefined) request.timezone = parsed.timezone
    if (parsed.unavailabilityReasonEntryId !== undefined) request.unavailabilityReasonEntryId = parsed.unavailabilityReasonEntryId ?? null
    if (parsed.unavailabilityReasonValue !== undefined) request.unavailabilityReasonValue = parsed.unavailabilityReasonValue ?? null
    if (parsed.note !== undefined) request.note = parsed.note ?? null
    request.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })

    return { requestId: request.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as LeaveRequestSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadLeaveRequestSnapshot(em, before.id)
    const changes = after
      ? buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
          'memberId',
          'startDate',
          'endDate',
          'timezone',
          'unavailabilityReasonEntryId',
          'unavailabilityReasonValue',
          'note',
        ])
      : {}
    return {
      actionLabel: translate('staff.audit.leaveRequests.update', 'Update leave request'),
      resourceKind: 'staff.leave_request',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: after ?? null,
        } satisfies LeaveRequestUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeaveRequestUndoPayload>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await em.findOne(StaffLeaveRequest, { id: after.id })
    if (!request) return
    request.startDate = new Date(before.startDate)
    request.endDate = new Date(before.endDate)
    request.timezone = before.timezone
    request.status = before.status
    request.unavailabilityReasonEntryId = before.unavailabilityReasonEntryId
    request.unavailabilityReasonValue = before.unavailabilityReasonValue
    request.note = before.note
    request.decisionComment = before.decisionComment
    request.decidedByUserId = before.decidedByUserId
    request.decidedAt = before.decidedAt ? new Date(before.decidedAt) : null
    request.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })
  },
}

const deleteLeaveRequestCommand: CommandHandler<{ id: string }, { requestId: string }> = {
  id: 'staff.leave-requests.delete',
  async execute(rawInput, ctx) {
    const parsed = staffLeaveRequestDecisionSchema.pick({ id: true }).parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await requireLeaveRequest(em, parsed.id)
    ensureTenantScope(ctx, request.tenantId)
    ensureOrganizationScope(ctx, request.organizationId)
    ensurePendingStatus(request)

    request.deletedAt = new Date()
    request.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })

    return { requestId: request.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadLeaveRequestSnapshot(em, result.requestId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeaveRequestSnapshot(em, result.requestId)
    return {
      actionLabel: translate('staff.audit.leaveRequests.delete', 'Delete leave request'),
      resourceKind: 'staff.leave_request',
      resourceId: result.requestId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies LeaveRequestUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeaveRequestUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await em.findOne(StaffLeaveRequest, { id: after.id })
    if (!request) return
    request.deletedAt = null
    request.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })
  },
}

const acceptLeaveRequestCommand: CommandHandler<StaffLeaveRequestDecisionInput, { requestId: string; ruleIds: string[] }> = {
  id: 'staff.leave-requests.accept',
  async execute(rawInput, ctx) {
    const parsed = staffLeaveRequestDecisionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await requireLeaveRequest(em, parsed.id)
    ensureTenantScope(ctx, request.tenantId)
    ensureOrganizationScope(ctx, request.organizationId)
    ensurePendingStatus(request)

    const memberId = typeof request.member === 'string' ? request.member : request.member.id
    const decidedByUserId = parsed.decidedByUserId ?? resolveAuthUserId(ctx)
    const now = new Date()
    const dates = listDateKeysInRange(request.startDate, request.endDate)
    let createdRuleIds: string[] = []

    await em.transactional(async (trx) => {
      request.status = 'approved'
      request.decisionComment = parsed.decisionComment ?? null
      request.decidedByUserId = decidedByUserId
      request.decidedAt = now
      request.updatedAt = now
      trx.persist(request)

      createdRuleIds = await createUnavailabilityRules({
        em: trx,
        tenantId: request.tenantId,
        organizationId: request.organizationId,
        memberId,
        timezone: request.timezone,
        dates,
        note: request.note ?? null,
        reasonEntryId: request.unavailabilityReasonEntryId ?? null,
        reasonValue: request.unavailabilityReasonValue ?? null,
      })
      await trx.flush()
    })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })
    if (createdRuleIds.length) {
      const rules = await em.find(PlannerAvailabilityRule, { id: { $in: createdRuleIds } })
      for (const rule of rules) {
        await emitCrudSideEffects({
          dataEngine: de,
          action: 'created',
          entity: rule,
          identifiers: {
            id: rule.id,
            organizationId: rule.organizationId,
            tenantId: rule.tenantId,
          },
          indexer: availabilityRuleCrudIndexer,
        })
      }
    }
    await invalidateAvailabilityCache({
      container: ctx.container,
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      ruleIds: createdRuleIds,
    })

    // Send notification to the requester
    if (request.submittedByUserId) {
      try {
        const notificationService = resolveNotificationService(ctx.container)
        const typeDef = notificationTypes.find((type) => type.type === 'staff.leave_request.approved')
        if (typeDef) {
          const startDateStr = request.startDate.toLocaleDateString()
          const endDateStr = request.endDate.toLocaleDateString()

          const notificationInput = buildNotificationFromType(typeDef, {
            recipientUserId: request.submittedByUserId,
            bodyVariables: {
              startDate: startDateStr,
              endDate: endDateStr,
            },
            sourceEntityType: 'staff:leave_request',
            sourceEntityId: request.id,
            linkHref: `/backend/staff/leave-requests/${request.id}`,
          })

          await notificationService.create(notificationInput, {
            tenantId: request.tenantId,
            organizationId: request.organizationId,
          })
        }
      } catch {
        // Notification creation is non-critical, don't fail the command
      }
    }

    return { requestId: request.id, ruleIds: createdRuleIds }
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as LeaveRequestSnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadLeaveRequestSnapshot(em, result.requestId)
    return {
      actionLabel: translate('staff.audit.leaveRequests.accept', 'Approve leave request'),
      resourceKind: 'staff.leave_request',
      resourceId: result.requestId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
          availabilityRuleIds: result.ruleIds,
        } satisfies LeaveRequestUndoPayload,
      },
    }
  },
  async prepare(rawInput, ctx) {
    const parsed = staffLeaveRequestDecisionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeaveRequestSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeaveRequestUndoPayload>(logEntry)
    const before = payload?.before
    const availabilityRuleIds = payload?.availabilityRuleIds ?? []
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await em.findOne(StaffLeaveRequest, { id: before.id })
    if (!request) return
    request.status = before.status
    request.decisionComment = before.decisionComment
    request.decidedByUserId = before.decidedByUserId
    request.decidedAt = before.decidedAt ? new Date(before.decidedAt) : null
    request.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })

    if (availabilityRuleIds.length) {
      const rules = await em.find(PlannerAvailabilityRule, { id: { $in: availabilityRuleIds } })
      const now = new Date()
      rules.forEach((rule) => {
        rule.deletedAt = now
        rule.updatedAt = now
      })
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      for (const rule of rules) {
        await emitCrudUndoSideEffects({
          dataEngine: de,
          action: 'deleted',
          entity: rule,
          identifiers: {
            id: rule.id,
            organizationId: rule.organizationId,
            tenantId: rule.tenantId,
          },
          indexer: availabilityRuleCrudIndexer,
        })
      }
    }
    await invalidateAvailabilityCache({
      container: ctx.container,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      ruleIds: availabilityRuleIds,
    })
  },
}

const rejectLeaveRequestCommand: CommandHandler<StaffLeaveRequestDecisionInput, { requestId: string }> = {
  id: 'staff.leave-requests.reject',
  async execute(rawInput, ctx) {
    const parsed = staffLeaveRequestDecisionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await requireLeaveRequest(em, parsed.id)
    ensureTenantScope(ctx, request.tenantId)
    ensureOrganizationScope(ctx, request.organizationId)
    ensurePendingStatus(request)

    request.status = 'rejected'
    request.decisionComment = parsed.decisionComment ?? null
    request.decidedByUserId = parsed.decidedByUserId ?? resolveAuthUserId(ctx)
    request.decidedAt = new Date()
    request.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })

    // Send notification to the requester
    if (request.submittedByUserId) {
      try {
        const notificationService = resolveNotificationService(ctx.container)
        const typeDef = notificationTypes.find((type) => type.type === 'staff.leave_request.rejected')
        if (typeDef) {
          const startDateStr = request.startDate.toLocaleDateString()
          const endDateStr = request.endDate.toLocaleDateString()

          const notificationInput = buildNotificationFromType(typeDef, {
            recipientUserId: request.submittedByUserId,
            bodyVariables: {
              startDate: startDateStr,
              endDate: endDateStr,
              reason: request.decisionComment ?? '',
            },
            sourceEntityType: 'staff:leave_request',
            sourceEntityId: request.id,
            linkHref: `/backend/staff/leave-requests/${request.id}`,
          })

          await notificationService.create(notificationInput, {
            tenantId: request.tenantId,
            organizationId: request.organizationId,
          })
        }
      } catch {
        // Notification creation is non-critical, don't fail the command
      }
    }

    return { requestId: request.id }
  },
  async prepare(rawInput, ctx) {
    const parsed = staffLeaveRequestDecisionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeaveRequestSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as LeaveRequestSnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadLeaveRequestSnapshot(em, result.requestId)
    return {
      actionLabel: translate('staff.audit.leaveRequests.reject', 'Reject leave request'),
      resourceKind: 'staff.leave_request',
      resourceId: result.requestId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies LeaveRequestUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeaveRequestUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await em.findOne(StaffLeaveRequest, { id: before.id })
    if (!request) return
    request.status = before.status
    request.decisionComment = before.decisionComment
    request.decidedByUserId = before.decidedByUserId
    request.decidedAt = before.decidedAt ? new Date(before.decidedAt) : null
    request.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: request,
      identifiers: {
        id: request.id,
        organizationId: request.organizationId,
        tenantId: request.tenantId,
      },
      indexer: leaveRequestCrudIndexer,
    })
  },
}

registerCommand(createLeaveRequestCommand)
registerCommand(updateLeaveRequestCommand)
registerCommand(deleteLeaveRequestCommand)
registerCommand(acceptLeaveRequestCommand)
registerCommand(rejectLeaveRequestCommand)
