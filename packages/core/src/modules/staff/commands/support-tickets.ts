import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  StaffSupportTicket,
  StaffTimeProject,
  StaffTimeTask,
  StaffTimeTaskComment,
  StaffTimeTaskStatus,
} from '../data/entities'
import { staffTimeTaskCommentCrudEvents } from '../lib/crud'
import { findSupportTicketCategory } from '../lib/support/dictionaries'
import { resolveSupportRoute } from '../lib/support/routing'
import { allocateTaskReference, withTaskReferenceRetry, isTaskReferenceConflict } from '../lib/timesheets-tasks/taskReference'
import {
  resolveAssignmentGraceDaysFromContainer,
  resolveUsableDefaultAssignee,
} from '../lib/time-tracking/projectAssignment'
import { readTimeTrackingSettings } from '../lib/time-tracking/settings'
import { DEFAULT_SUPPORT_REFERENCE_PREFIX } from '../lib/time-tracking/settingKeys'
import { emitStaffEvent } from '../events'
import {
  applyStatusToTask,
  emitTaskAssigneeChanged,
  nextTaskPosition,
  readHighestSequenceNumber,
  taskCrudEvents,
  taskCrudIndexer,
  TASK_LIST_CACHE_RESOURCE,
} from './timesheets-tasks'
import { explicitStaffCommandScope, extractUndoPayload, lockLiveProjectForWrite } from './shared'

const logger = createLogger('staff').child({ component: 'commands/support-tickets' })

export const staffSupportTicketCommandIds = {
  createFromPortal: 'staff.support_tickets.create_from_portal',
  portalMessage: 'staff.support_tickets.portal_message',
} as const

export const SUPPORT_TICKET_RESOURCE_KIND = 'staff.support_ticket'
export const SUPPORT_CATEGORY_UNAVAILABLE_CODE = 'support_category_unavailable'

const customerScopeFields = {
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerUserId: z.string().uuid(),
  customerDisplayName: z.string().max(255).optional().nullable(),
  customerKind: z.string().max(50).optional().nullable(),
  reporterDisplayName: z.string().max(255).optional().nullable(),
}

export const supportTicketCreateFromPortalSchema = z.object({
  ...customerScopeFields,
  categoryValue: z.string().trim().min(1).max(150),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10000),
})

export const supportTicketPortalMessageSchema = z.object({
  ...customerScopeFields,
  taskId: z.string().uuid(),
  body: z.string().trim().min(1).max(10000),
})

export type SupportTicketCreateFromPortalInput = z.infer<typeof supportTicketCreateFromPortalSchema>
export type SupportTicketPortalMessageInput = z.infer<typeof supportTicketPortalMessageSchema>

export type SupportTicketCreateResult = {
  taskId: string
  ticketId: string
  supportReference: string
  timeProjectId: string
  tenantId: string
  organizationId: string
}

export type SupportTicketMessageResult = {
  commentId: string
  taskId: string
  reopened: boolean
  previousTaskStatusId: string | null
  tenantId: string
  organizationId: string
}

type Translate = (key: string, fallback: string) => string

type CreateUndoPayload = {
  taskId: string
  ticketId: string
  tenantId: string
  organizationId: string
}

type MessageUndoPayload = {
  commentId: string
  taskId: string
  tenantId: string
  organizationId: string
  reopenedFromStatusId: string | null
}

const portalVisibleCommentEvents: CrudEventsConfig<StaffTimeTaskComment> = {
  ...staffTimeTaskCommentCrudEvents,
  buildPayload: (context) => ({
    ...((staffTimeTaskCommentCrudEvents.buildPayload ? staffTimeTaskCommentCrudEvents.buildPayload(context) : {}) as Record<string, unknown>),
    portalVisible: true,
  }),
}

function categoryUnavailableError(translate: Translate): CrudHttpError {
  const message = translate(
    'staff.support.errors.categoryUnavailable',
    'Support requests in this category are not available right now.',
  )
  return new CrudHttpError(422, {
    code: SUPPORT_CATEGORY_UNAVAILABLE_CODE,
    error: message,
    fieldErrors: { categoryValue: message },
  })
}

function ticketNotFoundError(translate: Translate): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.support.errors.ticketNotFound', 'Support ticket not found.'),
  })
}

export function formatSupportReference(prefix: string, sequenceNumber: number): string {
  return `${prefix}-${sequenceNumber}`
}

async function readSupportReferencePrefix(ctx: CommandRuntimeContext, tenantId: string): Promise<string> {
  try {
    const configService = ctx.container.resolve('moduleConfigService') as Parameters<typeof readTimeTrackingSettings>[0]
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    const prefix = settings.support?.referencePrefix
    return typeof prefix === 'string' && prefix.length > 0 ? prefix : DEFAULT_SUPPORT_REFERENCE_PREFIX
  } catch {
    return DEFAULT_SUPPORT_REFERENCE_PREFIX
  }
}

export async function readHighestSupportSequence(em: EntityManager, tenantId: string, organizationId: string): Promise<number> {
  const highest = await findOneWithDecryption(
    em,
    StaffSupportTicket,
    { tenantId, organizationId },
    { fields: ['id', 'supportSequenceNumber'], orderBy: { supportSequenceNumber: 'desc' } },
    { tenantId, organizationId },
  )
  return highest?.supportSequenceNumber ?? 0
}

function emitSupportEvent(eventId: Parameters<typeof emitStaffEvent>[0], payload: Record<string, unknown>): void {
  void emitStaffEvent(eventId, payload, { persistent: true }).catch((err) => {
    logger.error('staff support event emit failed', { err, eventId })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_event_emit_failed' })
  })
}

const createFromPortalCommand: CommandHandler<SupportTicketCreateFromPortalInput, SupportTicketCreateResult> = {
  id: staffSupportTicketCommandIds.createFromPortal,
  async execute(rawInput, ctx) {
    const parsed = supportTicketCreateFromPortalSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const commandScope = explicitStaffCommandScope(parsed.tenantId, parsed.organizationId)
    const baseEm = ctx.container.resolve('em') as EntityManager

    const category = await findSupportTicketCategory(baseEm.fork(), scope, parsed.categoryValue)
    if (!category) throw categoryUnavailableError(translate)
    const route = await resolveSupportRoute(baseEm.fork(), scope, category.value)
    if (!route) throw categoryUnavailableError(translate)

    const prefix = await readSupportReferencePrefix(ctx, parsed.tenantId)
    const graceDays = await resolveAssignmentGraceDaysFromContainer(ctx.container, parsed.tenantId)

    let result: { task: StaffTimeTask; ticket: StaffSupportTicket } | null = null
    try {
      result = await withTaskReferenceRetry(async () => {
        const em = baseEm.fork()
        let task: StaffTimeTask | null = null
        let ticket: StaffSupportTicket | null = null
        let plan: {
          project: StaffTimeProject
          status: StaffTimeTaskStatus
          position: number
          highestTaskSequence: number
          highestSupportSequence: number
          assigneeStaffMemberId: string | null
        } | null = null

        await withAtomicFlush(
          em,
          [
            async () => {
              const project = await lockLiveProjectForWrite(em, route.timeProjectId, commandScope)
              if (!project) throw categoryUnavailableError(translate)
              const status = await em.findOne(StaffTimeTaskStatus, {
                timeProjectId: project.id,
                tenantId: parsed.tenantId,
                organizationId: parsed.organizationId,
                isDefault: true,
                deletedAt: null,
              })
              if (!status) throw categoryUnavailableError(translate)
              plan = {
                project,
                status,
                position: await nextTaskPosition(em, project.id, status.id, commandScope),
                highestTaskSequence: await readHighestSequenceNumber(em, project.id, commandScope),
                highestSupportSequence: await readHighestSupportSequence(em, parsed.tenantId, parsed.organizationId),
                assigneeStaffMemberId: await resolveUsableDefaultAssignee(em, scope, project, { graceDays }),
              }
            },
            () => {
              if (!plan) throw categoryUnavailableError(translate)
              const now = new Date()
              const allocation = allocateTaskReference(plan.project.code, plan.highestTaskSequence)
              task = em.create(StaffTimeTask, {
                tenantId: parsed.tenantId,
                organizationId: parsed.organizationId,
                timeProjectId: plan.project.id,
                parentTaskId: null,
                taskStatusId: plan.status.id,
                sequenceNumber: allocation.sequenceNumber,
                reference: allocation.reference,
                title: parsed.subject,
                description: parsed.description,
                assigneeStaffMemberId: plan.assigneeStaffMemberId,
                position: plan.position,
                createdByUserId: null,
                closedAt: plan.status.isDone ? now : null,
                source: 'portal',
                customerId: parsed.customerId,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              })
              em.persist(task)
            },
            () => {
              if (!plan || !task) throw categoryUnavailableError(translate)
              const now = new Date()
              const supportSequenceNumber = plan.highestSupportSequence + 1
              ticket = em.create(StaffSupportTicket, {
                tenantId: parsed.tenantId,
                organizationId: parsed.organizationId,
                taskId: (task as StaffTimeTask).id,
                customerSnapshot: {
                  displayName: parsed.customerDisplayName ?? null,
                  kind: parsed.customerKind ?? null,
                  reporterDisplayName: parsed.reporterDisplayName ?? null,
                },
                reportedByCustomerUserId: parsed.customerUserId,
                supportReference: formatSupportReference(prefix, supportSequenceNumber),
                supportSequenceNumber,
                categoryValue: category.value,
                categorySnapshot: { value: category.value, label: category.label },
                routedVia: route.via,
                customerRequestSnapshot: { subject: parsed.subject, body: parsed.description },
                unnotifiedAt: null,
                portalStatusPublished: 'received',
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              })
              em.persist(ticket)
            },
          ],
          { transaction: true, label: staffSupportTicketCommandIds.createFromPortal },
        )
        if (!task || !ticket) throw ticketNotFoundError(translate)
        return { task: task as StaffTimeTask, ticket: ticket as StaffSupportTicket }
      })
    } catch (err) {
      if (isTaskReferenceConflict(err)) {
        throw new CrudHttpError(409, {
          code: 'support_reference_conflict',
          error: translate('staff.support.errors.referenceConflict', 'Too many tickets were filed at once. Please submit again.'),
        })
      }
      throw err
    }

    const { task, ticket } = result
    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      events: taskCrudEvents,
      indexer: taskCrudIndexer,
    })
    const basePayload = { tenantId: task.tenantId, organizationId: task.organizationId }
    emitSupportEvent('staff.support_ticket.created', {
      ...basePayload,
      id: ticket.id,
      taskId: task.id,
      projectId: task.timeProjectId,
      customerId: parsed.customerId,
      supportReference: ticket.supportReference,
      categoryValue: ticket.categoryValue,
    })
    emitSupportEvent('staff.support_ticket.activity_recorded', {
      ...basePayload,
      id: ticket.id,
      taskId: task.id,
      projectId: task.timeProjectId,
      kind: 'created',
    })
    if (task.assigneeStaffMemberId) emitTaskAssigneeChanged(task, null, 'default', null)

    return {
      taskId: task.id,
      ticketId: ticket.id,
      supportReference: ticket.supportReference,
      timeProjectId: task.timeProjectId,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.support.tickets.create', 'File support ticket'),
      resourceKind: SUPPORT_TICKET_RESOURCE_KIND,
      resourceId: result.ticketId,
      parentResourceKind: 'staff.timesheets.task',
      parentResourceId: result.taskId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      context: { cacheAliases: [TASK_LIST_CACHE_RESOURCE] },
      payload: {
        undo: {
          taskId: result.taskId,
          ticketId: result.ticketId,
          tenantId: result.tenantId,
          organizationId: result.organizationId,
        } satisfies CreateUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CreateUndoPayload>(logEntry)
    if (!payload?.taskId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const where = { tenantId: payload.tenantId, organizationId: payload.organizationId }
    const task = await em.findOne(StaffTimeTask, { id: payload.taskId, ...where })
    const ticket = await findOneWithDecryption(em, StaffSupportTicket, { id: payload.ticketId, ...where }, undefined, where)
    await withAtomicFlush(em, [() => {
      const now = new Date()
      if (task && !task.deletedAt) {
        task.deletedAt = now
        task.updatedAt = now
      }
      if (ticket && !ticket.deletedAt) {
        ticket.deletedAt = now
        ticket.updatedAt = now
      }
    }], { transaction: true, label: `${staffSupportTicketCommandIds.createFromPortal}.undo` })
    if (task) {
      await emitCrudUndoSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'deleted',
        entity: task,
        identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
        events: taskCrudEvents,
        indexer: taskCrudIndexer,
      })
    }
  },
}

const portalMessageCommand: CommandHandler<SupportTicketPortalMessageInput, SupportTicketMessageResult> = {
  id: staffSupportTicketCommandIds.portalMessage,
  async execute(rawInput, ctx) {
    const parsed = supportTicketPortalMessageSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const task = await em.findOne(StaffTimeTask, {
      id: parsed.taskId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      customerId: parsed.customerId,
      source: 'portal',
      deletedAt: null,
    })
    if (!task) throw ticketNotFoundError(translate)
    const ticket = await findOneWithDecryption(
      em,
      StaffSupportTicket,
      { taskId: task.id, tenantId: parsed.tenantId, organizationId: parsed.organizationId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!ticket) throw ticketNotFoundError(translate)

    let comment: StaffTimeTaskComment | null = null
    let reopenedFromStatusId: string | null = null
    await withAtomicFlush(
      em,
      [
        async () => {
          const currentStatus = await em.findOne(StaffTimeTaskStatus, {
            id: task.taskStatusId,
            tenantId: task.tenantId,
            organizationId: task.organizationId,
          })
          if (!currentStatus?.isDone) return
          const defaultStatus = await em.findOne(StaffTimeTaskStatus, {
            timeProjectId: task.timeProjectId,
            tenantId: task.tenantId,
            organizationId: task.organizationId,
            isDefault: true,
            deletedAt: null,
          })
          if (!defaultStatus) return
          reopenedFromStatusId = task.taskStatusId
          applyStatusToTask(task, defaultStatus, new Date())
          task.updatedAt = new Date()
        },
        () => {
          const now = new Date()
          comment = em.create(StaffTimeTaskComment, {
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
            taskId: task.id,
            body: parsed.body,
            authorUserId: null,
            visibility: 'customer',
            authorKind: 'customer',
            authorCustomerUserId: parsed.customerUserId,
            authorDisplaySnapshot: { displayName: parsed.reporterDisplayName ?? parsed.customerDisplayName ?? '' },
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          em.persist(comment)
        },
      ],
      { transaction: true, label: staffSupportTicketCommandIds.portalMessage },
    )
    const record = comment as StaffTimeTaskComment | null
    if (!record) throw ticketNotFoundError(translate)

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'created',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: portalVisibleCommentEvents,
    })
    const basePayload = { tenantId: task.tenantId, organizationId: task.organizationId }
    if (reopenedFromStatusId) {
      await emitCrudSideEffects({
        dataEngine: ctx.container.resolve('dataEngine'),
        action: 'updated',
        entity: task,
        identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
        events: taskCrudEvents,
        indexer: taskCrudIndexer,
      })
      void emitStaffEvent('staff.timesheets.time_task.status_changed', {
        id: task.id,
        ...basePayload,
        taskId: task.id,
        timeProjectId: task.timeProjectId,
        previousTaskStatusId: reopenedFromStatusId,
        taskStatusId: task.taskStatusId,
      }).catch((err) => {
        logger.error('staff support reopen status event failed', { err, taskId: task.id })
        getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_reopen_event_failed' })
      })
    }
    emitSupportEvent('staff.support_ticket.customer_replied', {
      ...basePayload,
      id: ticket.id,
      taskId: task.id,
      projectId: task.timeProjectId,
      commentId: record.id,
      supportReference: ticket.supportReference,
    })
    emitSupportEvent('staff.support_ticket.activity_recorded', {
      ...basePayload,
      id: ticket.id,
      taskId: task.id,
      projectId: task.timeProjectId,
      kind: 'customer_replied',
    })

    return {
      commentId: record.id,
      taskId: task.id,
      reopened: reopenedFromStatusId !== null,
      previousTaskStatusId: reopenedFromStatusId,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.support.tickets.message', 'Customer message on support ticket'),
      resourceKind: 'staff.timesheets.task_comment',
      resourceId: result.commentId,
      parentResourceKind: 'staff.timesheets.task',
      parentResourceId: result.taskId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      context: { cacheAliases: [TASK_LIST_CACHE_RESOURCE] },
      payload: {
        undo: {
          commentId: result.commentId,
          taskId: result.taskId,
          tenantId: result.tenantId,
          organizationId: result.organizationId,
          reopenedFromStatusId: result.previousTaskStatusId,
        } satisfies MessageUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<MessageUndoPayload>(logEntry)
    if (!payload?.commentId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const where = { tenantId: payload.tenantId, organizationId: payload.organizationId }
    const comment = await em.findOne(StaffTimeTaskComment, { id: payload.commentId, ...where })
    const task = payload.reopenedFromStatusId ? await em.findOne(StaffTimeTask, { id: payload.taskId, ...where }) : null
    const previousStatus = payload.reopenedFromStatusId
      ? await em.findOne(StaffTimeTaskStatus, { id: payload.reopenedFromStatusId, ...where })
      : null
    await withAtomicFlush(em, [() => {
      const now = new Date()
      if (comment && !comment.deletedAt) {
        comment.deletedAt = now
        comment.updatedAt = now
      }
      if (task && previousStatus) {
        applyStatusToTask(task, previousStatus, now)
        task.updatedAt = now
      }
    }], { transaction: true, label: `${staffSupportTicketCommandIds.portalMessage}.undo` })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (comment) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: comment,
        identifiers: { id: comment.id, organizationId: comment.organizationId, tenantId: comment.tenantId },
        events: portalVisibleCommentEvents,
      })
    }
    if (task && previousStatus) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'updated',
        entity: task,
        identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
        events: taskCrudEvents,
        indexer: taskCrudIndexer,
      })
    }
  },
}

registerCommand(createFromPortalCommand)
registerCommand(portalMessageCommand)
