import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import {
  HrApprovalActionLog,
  HrApprovalRequest,
  HrApprovalStepDefinition,
  HrApprovalWorkflow,
  HrAttendanceRecord,
  HrEmployee,
  HrEmployeeIncentive,
  HrEmployeeLoan,
  HrEmployeePenalty,
  HrLeaveRequest,
  HrPayrollRun,
} from '../data/entities'
import { raiseHrError } from '../lib/errors'
import { emitHrEvent } from '../events'
import {
  authorizeApprovalStep,
  resolveReassignedApprover,
} from '../lib/approvalAuthorization'
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
  HR_ATTENDANCE_ENTITY_ID,
  HR_LEAVE_REQUEST_ENTITY_ID,
  hrAttendanceEvents,
  hrAttendanceIndexer,
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

export const submitForEntityInputSchema = z.object({
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

type PrincipalService = {
  resolveActiveUserRoleIds: (
    userId: string,
    scope: { tenantId: string; organizationId: string },
  ) => Promise<string[]>
  principalExists: (input: {
    type: 'user' | 'role'
    id: string
    scope: { tenantId: string; organizationId: string }
  }) => Promise<boolean>
}

function resolvePrincipalService(ctx: CommandRuntimeContext): PrincipalService {
  return ctx.container.resolve('authPrincipalService') as PrincipalService
}

async function resolveTargetEmployeeId(
  em: EntityManager,
  scope: ApprovalScope,
  request: HrApprovalRequest,
): Promise<string | null> {
  if (request.entityType === 'hr_leave_request') {
    const leaveRequest = await em.findOne(HrLeaveRequest, {
      id: request.entityId,
      ...scope,
      deletedAt: null,
    })
    return leaveRequest?.employeeId ?? null
  }
  if (request.entityType === 'hr_attendance_record') {
    const record = await em.findOne(HrAttendanceRecord, {
      id: request.entityId,
      ...scope,
      deletedAt: null,
    })
    return record?.employeeId ?? null
  }
  const payloadEmployeeId = request.payload?.employeeId
  return typeof payloadEmployeeId === 'string' ? payloadEmployeeId : null
}

/**
 * The user a `manager` step must resolve to: the target employee's manager's auth user.
 *
 * A manager employee without a linked user cannot decide anything, so it resolves to
 * `null` and the engine answers `approval_approver_unresolved` rather than letting the
 * request sit at a step nobody can act on.
 */
async function resolveTargetManagerUserId(
  em: EntityManager,
  scope: ApprovalScope,
  request: HrApprovalRequest,
): Promise<string | null> {
  const employeeId = await resolveTargetEmployeeId(em, scope, request)
  if (!employeeId) return null
  const employee = await em.findOne(HrEmployee, { id: employeeId, ...scope, deletedAt: null })
  if (!employee?.managerEmployeeId) return null
  const manager = await em.findOne(HrEmployee, {
    id: employee.managerEmployeeId,
    ...scope,
    deletedAt: null,
  })
  return manager?.userId ?? null
}

function appendComment(comment: string | null | undefined, extra: string): string | null {
  const trimmed = comment?.trim() ?? ''
  if (trimmed.length === 0) return extra
  return `${trimmed}\n${extra}`
}

/**
 * Emits the side effects for whatever entity a decision touched.
 *
 * Returning a function rather than the entity keeps both branches type-safe: the leave branch
 * builds an emitter typed for leave requests and the attendance branch one typed for
 * attendance records, so neither has to be cast at the call site.
 */
type TargetEmitter = (dataEngine: DataEngine) => Promise<void>

/**
 * Applies the outcome of a decision to the entity the request is about.
 *
 * Wired today: leave requests (a decision records the outcome) and attendance records (an
 * approved lateness permission turns `late` into `present`, a rejected one leaves the
 * lateness standing). Anything else completes the approval request and leaves the target
 * alone, which is stated here rather than silently no-oped; the fleet assignment hook is a
 * separate change.
 */
async function applyTargetEffect(
  em: EntityManager,
  scope: ApprovalScope,
  request: HrApprovalRequest,
  decision: Extract<ApprovalDecision, { kind: 'ok' }>,
  actorUserId: string | null,
  comment: string | null | undefined,
): Promise<TargetEmitter | null> {
  if (!decision.decided) return null
  const now = new Date()

  if (request.entityType === 'hr_leave_request') {
    const leaveRequest = await em.findOne(HrLeaveRequest, {
      id: request.entityId,
      ...scope,
      deletedAt: null,
    }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!leaveRequest) return null

    leaveRequest.status = decision.status === 'approved' ? 'approved' : 'rejected'
    leaveRequest.decidedByUserId = actorUserId
    leaveRequest.decidedAt = now
    leaveRequest.decisionComment = comment ?? null
    leaveRequest.updatedAt = now
    await em.persist(leaveRequest).flush()

    return async (dataEngine) => {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: leaveRequest,
        identifiers: { id: leaveRequest.id, ...scope },
        actorUserId,
        events: hrLeaveRequestEvents,
        indexer: hrLeaveRequestIndexer,
      })
    }
  }

  if (request.entityType === 'hr_attendance_record') {
    // A rejected or cancelled permission must change nothing: the lateness stands.
    if (decision.status !== 'approved') return null
    const record = await em.findOne(HrAttendanceRecord, {
      id: request.entityId,
      ...scope,
      deletedAt: null,
    }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    // Only an existing late record can be excused; approving a permission for a day the
    // employee was present would rewrite history that nobody disputed.
    if (!record || record.status !== 'late') return null

    record.status = 'present'
    record.updatedAt = now
    await em.persist(record).flush()

    return async (dataEngine) => {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: record,
        identifiers: { id: record.id, ...scope },
        actorUserId,
        events: hrAttendanceEvents,
        indexer: hrAttendanceIndexer,
      })
    }
  }

  if (
    request.entityType === 'hr_employee_loan'
    || request.entityType === 'hr_employee_penalty'
    || request.entityType === 'hr_employee_incentive'
  ) {
    const entity = request.entityType === 'hr_employee_loan'
      ? await em.findOne(HrEmployeeLoan, { id: request.entityId, ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      : request.entityType === 'hr_employee_penalty'
        ? await em.findOne(HrEmployeePenalty, { id: request.entityId, ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        : await em.findOne(HrEmployeeIncentive, { id: request.entityId, ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!entity) return null
    entity.status = decision.status === 'approved' ? 'approved' : 'rejected'
    entity.decidedByUserId = actorUserId
    entity.decidedAt = now
    entity.updatedAt = now
    await em.persist(entity).flush()
    return null
  }

  if (request.entityType === 'hr_payroll_run') {
    const run = await em.findOne(HrPayrollRun, {
      id: request.entityId,
      ...scope,
      deletedAt: null,
    }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!run) return null
    if (decision.status === 'approved') {
      run.status = 'approved'
      run.updatedAt = now
      await em.persist(run).flush()
      return async () => {
        await emitHrEvent('hr_management.payroll_run.approved', {
          id: run.id,
          periodStart: run.periodStart.toISOString().slice(0, 10),
          periodEnd: run.periodEnd.toISOString().slice(0, 10),
          grossTotal: run.grossTotal,
          deductionTotal: run.deductionTotal,
          netTotal: run.netTotal,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      }
    }
    if (run.status === 'submitted') {
      run.status = 'calculated'
      run.updatedAt = now
      await em.persist(run).flush()
    }
    return null
  }

  if (request.entityType === 'fleet_vehicle_assignment') {
    return async () => {
      await emitHrEvent('hr_management.approval_request.decided', {
        approvalRequestId: request.id,
        entityType: request.entityType,
        entityId: request.entityId,
        status: decision.status,
        decidedByUserId: actorUserId,
        comment: comment ?? null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    }
  }

  return null
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

    // Strictly additive: without an expected-version header (a plain API client) this is a no-op.
    // The race it closes is a quorum of two: approver A moves the request to the next step, and
    // approver B, whose page still shows the previous step, would otherwise record an approval at
    // a step B never saw. The already-decided case is checked first on purpose — "another approver
    // decided this" is a more useful message than a version conflict with nothing to retry.
    // The async seam, not the sync helper: this is the entry point the optional enterprise
    // record-lock guard plugs into, and a direct call would bypass it (the repo-wide
    // optimistic-lock-command-coverage guard requires exactly one of the two).
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: HR_APPROVAL_REQUEST_ENTITY_ID,
      resourceId: request.id,
      current: request.updatedAt,
      request: ctx.request,
    })

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

    const currentStep = await transactionEm.findOne(HrApprovalStepDefinition, {
      workflowId: request.workflowId,
      stepOrder: request.currentStepOrder,
      ...scope,
      deletedAt: null,
    })
    if (!currentStep) {
      return raiseHrError(400, 'step_not_found', 'The current approval step no longer exists in the workflow.')
    }

    const principalService = resolvePrincipalService(ctx)
    const actorRoleIds = actorUserId
      ? await principalService.resolveActiveUserRoleIds(actorUserId, scope)
      : []
    const targetEmployeeManagerUserId = await resolveTargetManagerUserId(transactionEm, scope, request)
    const reassignedToUserId = resolveReassignedApprover(request.payload, request.currentStepOrder)
    const authorization = authorizeApprovalStep({
      action,
      step: {
        approverType: currentStep.approverType,
        approverRoleId: currentStep.approverRoleId ?? null,
        approverUserId: currentStep.approverUserId ?? null,
      },
      actor: {
        actorUserId,
        actorRoleIds,
        targetEmployeeManagerUserId,
        requestedByUserId: request.requestedByUserId ?? null,
        reassignedToUserId,
      },
    })
    if (!authorization.ok) {
      return authorization.code === 'approval_approver_unresolved'
        ? raiseHrError(409, authorization.code, 'The approver for this step could not be resolved.')
        : raiseHrError(403, authorization.code, 'You are not the approver for this step.')
    }

    if (action === 'reassign' && input.reassignToUserId) {
      const targetExists = await principalService.principalExists({
        type: 'user',
        id: input.reassignToUserId,
        scope,
      })
      if (!targetExists) {
        return raiseHrError(400, 'reassign_target_not_found', 'The selected reassignment target does not exist.')
      }
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
    const previousPayload = (typeof request.payload === 'object' && request.payload !== null)
      ? request.payload as Record<string, unknown>
      : {}
    if (action === 'reassign' && input.reassignToUserId) {
      const existing = previousPayload.reassignments
      const reassignments = (existing && typeof existing === 'object' && !Array.isArray(existing))
        ? existing as Record<string, unknown>
        : {}
      request.payload = {
        ...previousPayload,
        reassignments: { ...reassignments, [String(request.currentStepOrder)]: input.reassignToUserId },
        reassignedToUserId: input.reassignToUserId,
      }
    } else if (decision.currentStepOrder !== request.currentStepOrder) {
      // The legacy scalar names a single user and would otherwise follow the request
      // into the next step. The per-step map already scopes every override.
      const nextPayload = { ...previousPayload }
      delete nextPayload.reassignedToUserId
      request.payload = nextPayload
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
    await result.target(dataEngine)
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
      // The picker filters by target, but the API is reachable without it. A workflow whose
      // target differs would complete and change nothing, which is worse than a refusal.
      if (workflow.entityType !== input.entityType) {
        return raiseHrError(400, 'workflow_target_mismatch', 'This workflow is not defined for that record type.')
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

      const duplicate = await transactionEm.findOne(HrApprovalRequest, {
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'pending',
        ...scope,
        deletedAt: null,
      })
      if (duplicate) {
        return raiseHrError(409, 'approval_request_already_pending', 'This record already has a pending approval request.')
      }

      if (input.entityType === 'hr_leave_request') {
        const leaveRequest = await transactionEm.findOne(HrLeaveRequest, {
          id: input.entityId,
          ...scope,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!leaveRequest) {
          return raiseHrError(404, 'leave_request_not_found', 'The leave request does not exist.')
        }
        if (leaveRequest.status !== 'pending') {
          return raiseHrError(409, 'leave_request_not_pending', 'Only a pending leave request can be submitted for approval.')
        }
      }
      if (input.entityType === 'hr_attendance_record') {
        const record = await transactionEm.findOne(HrAttendanceRecord, {
          id: input.entityId,
          ...scope,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!record) {
          return raiseHrError(404, 'attendance_record_not_found', 'The attendance record does not exist.')
        }
        if (record.status !== 'late') {
          return raiseHrError(409, 'attendance_not_late', 'Only a late attendance record can request a lateness permission.')
        }
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

const submitForEntityCommand: CommandHandler<
  z.infer<typeof submitForEntityInputSchema>,
  { submitted: boolean; approvalRequestId?: string }
> = {
  id: 'hr_management.approvals.submit_for_entity',
  async execute(rawInput, ctx) {
    const input = submitForEntityInputSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const workflow = await em.findOne(HrApprovalWorkflow, {
      entityType: input.entityType,
      isActive: true,
      ...scope,
      deletedAt: null,
    }, { orderBy: { createdAt: 'asc' } })
    if (!workflow) return { submitted: false }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, DecisionOutcome>('hr_management.approvals.submit', {
      input: {
        workflowId: workflow.id,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary ?? null,
        payload: input.payload,
      },
      ctx,
    })
    return { submitted: true, approvalRequestId: result.approvalRequestId }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Submit approval request',
      resourceKind: 'hr_management:approval_request',
      resourceId: result.approvalRequestId ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(submitApprovalCommand)
registerCommand(submitForEntityCommand)
registerCommand(approveApprovalCommand)
registerCommand(rejectApprovalCommand)
registerCommand(reassignApprovalCommand)
registerCommand(cancelApprovalCommand)


