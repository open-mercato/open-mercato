import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import {
  HrApprovalActionLog,
  HrApprovalRequest,
  HrApprovalStepDefinition,
  HrApprovalWorkflow,
  HrLeaveRequest,
} from '../data/entities'
import { raiseHrError } from '../lib/errors'
import {
  countApprovals,
  decideApproval,
  isDecided,
  type ApprovalDecision,
  type ApprovalLogAction,
  type ApprovalStep,
} from '../lib/approvalState'
import {
  HR_APPROVAL_ACTION_LOG_ENTITY_ID,
  HR_APPROVAL_REQUEST_ENTITY_ID,
  HR_LEAVE_REQUEST_ENTITY_ID,
  hrLeaveRequestEvents,
  hrLeaveRequestIndexer,
  makeEvents,
  makeIndexer,
} from './hr'

type ApprovalScope = { tenantId: string; organizationId: string }

function resolveScope(ctx: CommandRuntimeContext): ApprovalScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  // Thrown, not raised through `raiseHrError`: that helper is async (it resolves
  // translations), so it returns a promise and narrows nothing for the type checker.
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Tenant and organization context are required.' })
  }
  return { tenantId, organizationId }
}

// The action log is written by this engine and has no CRUD route, so its events and
// indexer are built here from the shared factories rather than in commands/hr.ts.
const hrApprovalActionLogEvents = makeEvents<HrApprovalActionLog>('approval_action_log')
const hrApprovalActionLogIndexer = makeIndexer<HrApprovalActionLog>(HR_APPROVAL_ACTION_LOG_ENTITY_ID)

// Same reason: commands/hr.ts does not export these, and the engine is the only writer of
// approval requests that needs to announce them.
const hrApprovalRequestEvents = makeEvents<HrApprovalRequest>('approval_request')
const hrApprovalRequestIndexer = makeIndexer<HrApprovalRequest>(HR_APPROVAL_REQUEST_ENTITY_ID)

/**
 * Action DTOs for the engine.
 *
 * Unlike the fleet assignment action schemas these live next to the commands rather than in
 * `data/validators.ts` because they are command inputs, not entity payloads: the API routes
 * pass them through `parseScopedCommandInput`-style parsing only after the command has been
 * resolved, so the route layer validates nothing itself.
 */
export const submitApprovalInputSchema = z.object({
  workflowId: z.string().uuid(),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  summary: z.string().trim().min(1).optional().nullable(),
  payload: z.unknown().optional(),
})

export const decideApprovalInputSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().trim().min(1).optional().nullable(),
})

export const reassignApprovalInputSchema = decideApprovalInputSchema.extend({
  approverUserId: z.string().uuid(),
})

async function loadSteps(em: EntityManager, scope: ApprovalScope, workflowId: string): Promise<ApprovalStep[]> {
  const rows = await em.find(HrApprovalStepDefinition, {
    workflowId,
    ...scope,
    deletedAt: null,
  })
  return rows
    .map((row) => ({
      stepOrder: row.stepOrder,
      approverType: row.approverType,
      requiredApprovals: row.requiredApprovals ?? 1,
      isFinal: row.isFinal === true,
    }))
    .sort((left, right) => left.stepOrder - right.stepOrder)
}

async function loadLogs(em: EntityManager, scope: ApprovalScope, approvalRequestId: string) {
  return em.find(HrApprovalActionLog, { approvalRequestId, ...scope, deletedAt: null })
}

function appendComment(comment: string | null | undefined, extra: string): string | null {
  const trimmed = comment?.trim() ?? ''
  if (trimmed.length === 0) return extra
  return `${trimmed}\n${extra}`
}

/**
 * Applies the outcome of a decision to the entity the request is about.
 *
 * Only leave requests are wired today. Anything else completes the approval request and
 * leaves the target alone, which is the honest behaviour: a silent no-op would be worse,
 * and the fleet assignment hook is a separate change.
 */
async function applyTargetEffect(
  em: EntityManager,
  scope: ApprovalScope,
  request: HrApprovalRequest,
  decision: Extract<ApprovalDecision, { kind: 'ok' }>,
  actorUserId: string | null,
  comment: string | null | undefined,
): Promise<{ entity: HrLeaveRequest; events: typeof hrLeaveRequestEvents; indexer: typeof hrLeaveRequestIndexer } | null> {
  if (!decision.decided) return null
  if (request.entityType !== 'hr_leave_request') return null

  const leaveRequest = await em.findOne(HrLeaveRequest, {
    id: request.entityId,
    ...scope,
    deletedAt: null,
  }, { lockMode: LockMode.PESSIMISTIC_WRITE })
  if (!leaveRequest) return null

  const now = new Date()
  leaveRequest.status = decision.status === 'approved' ? 'approved' : 'rejected'
  leaveRequest.decidedByUserId = actorUserId
  leaveRequest.decidedAt = now
  leaveRequest.decisionComment = comment ?? null
  leaveRequest.updatedAt = now
  await em.persist(leaveRequest).flush()
  return { entity: leaveRequest, events: hrLeaveRequestEvents, indexer: hrLeaveRequestIndexer }
}

function logActionFor(decision: Extract<ApprovalDecision, { kind: 'ok' }>): ApprovalLogAction | null {
  return decision.logAction ?? null
}

type DecisionOutcome = {
  approvalRequestId: string
  status: string
  currentStepOrder: number
  decided: boolean
}

type DecisionInput = { id: string; comment?: string | null; reassignToUserId?: string | null }

/**
 * Shared execution path for approve / reject / reassign / cancel.
 *
 * One transaction: the request row is locked, its steps and log rows are read inside the
 * same transaction (the quorum must be counted from committed state, not from a stale
 * read), the decision is applied, the log row is written, and only then is the target
 * entity touched. Side effects are emitted after the commit so a rolled-back transaction
 * never announces an event.
 */
async function runDecision(
  action: 'approve' | 'reject' | 'reassign' | 'cancel',
  input: DecisionInput,
  ctx: CommandRuntimeContext,
): Promise<DecisionOutcome> {
  const scope = resolveScope(ctx)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const actorUserId = ctx.auth?.sub ?? null

  const result = await em.transactional(async (transactionEm) => {
    const request = await transactionEm.findOne(HrApprovalRequest, {
      id: input.id,
      ...scope,
      deletedAt: null,
    }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!request) return raiseHrError(404, 'approval_request_not_found', 'Approval request not found.')
    if (isDecided(request.status)) {
      return raiseHrError(409, 'approval_already_decided', 'This request has already been decided.')
    }

    const steps = await loadSteps(transactionEm, scope, request.workflowId)
    const logs = await loadLogs(transactionEm, scope, request.id)
    const decision = decideApproval({
      action,
      status: request.status,
      currentStepOrder: request.currentStepOrder,
      steps,
      approvalsAtCurrentStep: countApprovals(logs, request.currentStepOrder),
      reassignToUserId: input.reassignToUserId ?? null,
    })
    if (decision.kind === 'error') {
      return raiseHrError(400, decision.code, 'This approval action cannot be applied to the request.')
    }

    const now = new Date()
    const comment = input.comment ?? null
    const log = transactionEm.create(HrApprovalActionLog, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      approvalRequestId: request.id,
      stepOrder: decision.currentStepOrder,
      action: logActionFor(decision) ?? 'commented',
      actorUserId,
      comment: action === 'reassign' && input.reassignToUserId
        ? appendComment(comment, `reassigned_to:${input.reassignToUserId}`)
        : comment,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })

    request.status = decision.status
    request.currentStepOrder = decision.currentStepOrder
    if (decision.decided) request.decidedAt = now
    if (action === 'reassign' && input.reassignToUserId) {
      const previous = (typeof request.payload === 'object' && request.payload !== null)
        ? request.payload as Record<string, unknown>
        : {}
      request.payload = { ...previous, reassignedToUserId: input.reassignToUserId }
    }
    request.updatedAt = now
    await transactionEm.persist([request, log]).flush()

    const target = await applyTargetEffect(transactionEm, scope, request, decision, actorUserId, comment)
    return { request, log, target, now }
  })

  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'created',
    entity: result.log,
    identifiers: { id: result.log.id, ...scope },
    actorUserId,
    events: hrApprovalActionLogEvents,
    indexer: hrApprovalActionLogIndexer,
  })
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: result.request,
    identifiers: { id: result.request.id, ...scope },
    actorUserId,
    events: hrApprovalRequestEvents,
    indexer: hrApprovalRequestIndexer,
  })
  if (result.target) {
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: result.target.entity,
      identifiers: { id: result.target.entity.id, ...scope },
      actorUserId,
      events: result.target.events,
      indexer: result.target.indexer,
    })
  }

  return {
    approvalRequestId: result.request.id,
    status: result.request.status,
    currentStepOrder: result.request.currentStepOrder,
    decided: isDecided(result.request.status),
  }
}

function approvalLog(actionLabel: string) {
  return ({ result, ctx }: { result: DecisionOutcome; ctx: CommandRuntimeContext }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel,
      resourceKind: HR_APPROVAL_REQUEST_ENTITY_ID,
      resourceId: result.approvalRequestId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  }
}

const submitApprovalCommand: CommandHandler<Record<string, unknown>, DecisionOutcome> = {
  id: 'hr_management.approvals.submit',
  async execute(rawInput, ctx) {
    const input = submitApprovalInputSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const request = await em.transactional(async (transactionEm) => {
      const workflow = await transactionEm.findOne(HrApprovalWorkflow, {
        id: input.workflowId,
        ...scope,
        deletedAt: null,
      })
      if (!workflow) return raiseHrError(404, 'workflow_not_found', 'Approval workflow not found.')
      if (workflow.isActive !== true) {
        return raiseHrError(400, 'workflow_inactive', 'This approval workflow is not active.')
      }

      const steps = await loadSteps(transactionEm, scope, input.workflowId)
      const decision = decideApproval({
        action: 'submit',
        status: 'pending',
        currentStepOrder: 0,
        steps,
        approvalsAtCurrentStep: 0,
      })
      if (decision.kind === 'error') {
        return raiseHrError(400, decision.code, 'This approval workflow has no steps configured.')
      }

      const now = new Date()
      const created = transactionEm.create(HrApprovalRequest, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        workflowId: input.workflowId,
        entityType: input.entityType,
        entityId: input.entityId,
        status: decision.status,
        currentStepOrder: decision.currentStepOrder,
        requestedByUserId: actorUserId,
        decidedAt: null,
        summary: input.summary ?? null,
        payload: input.payload ?? null,
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      await transactionEm.persist(created).flush()

      // Links the target record back to its request. Without this the approval completes
      // and the leave request records the outcome, but nothing on the record says which
      // request produced it, so the UI cannot show or chase the decision.
      if (input.entityType === 'hr_leave_request') {
        const leaveRequest = await transactionEm.findOne(HrLeaveRequest, {
          id: input.entityId,
          ...scope,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (leaveRequest) {
          leaveRequest.approvalRequestId = created.id
          leaveRequest.updatedAt = now
          await transactionEm.persist(leaveRequest).flush()
        }
      }

      return created
    })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: request,
      identifiers: { id: request.id, ...scope },
      actorUserId,
      events: hrApprovalRequestEvents,
      indexer: hrApprovalRequestIndexer,
    })

    return {
      approvalRequestId: request.id,
      status: request.status,
      currentStepOrder: request.currentStepOrder,
      decided: false,
    }
  },
  buildLog: approvalLog('Submit approval request'),
}

const approveApprovalCommand: CommandHandler<Record<string, unknown>, DecisionOutcome> = {
  id: 'hr_management.approvals.approve',
  async execute(rawInput, ctx) {
    return runDecision('approve', decideApprovalInputSchema.parse(rawInput), ctx)
  },
  buildLog: approvalLog('Approve request'),
}

const rejectApprovalCommand: CommandHandler<Record<string, unknown>, DecisionOutcome> = {
  id: 'hr_management.approvals.reject',
  async execute(rawInput, ctx) {
    return runDecision('reject', decideApprovalInputSchema.parse(rawInput), ctx)
  },
  buildLog: approvalLog('Reject request'),
}

const reassignApprovalCommand: CommandHandler<Record<string, unknown>, DecisionOutcome> = {
  id: 'hr_management.approvals.reassign',
  async execute(rawInput, ctx) {
    return runDecision('reassign', reassignApprovalInputSchema.parse(rawInput), ctx)
  },
  buildLog: approvalLog('Reassign request'),
}

const cancelApprovalCommand: CommandHandler<Record<string, unknown>, DecisionOutcome> = {
  id: 'hr_management.approvals.cancel',
  async execute(rawInput, ctx) {
    return runDecision('cancel', decideApprovalInputSchema.parse(rawInput), ctx)
  },
  buildLog: approvalLog('Cancel request'),
}

registerCommand(submitApprovalCommand)
registerCommand(approveApprovalCommand)
registerCommand(rejectApprovalCommand)
registerCommand(reassignApprovalCommand)
registerCommand(cancelApprovalCommand)


