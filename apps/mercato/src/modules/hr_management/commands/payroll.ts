import { z } from 'zod'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  registerCommand,
  type CommandBus,
  type CommandHandler,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  HrApprovalWorkflow,
  HrAttendanceRecord,
  HrEmployee,
  HrEmployeeCompensation,
  HrEmployeeIncentive,
  HrEmployeeLoan,
  HrEmployeePenalty,
  HrLeaveRequest,
  HrLoanInstalment,
  HrPayrollRun,
  HrPayslip,
  HrPayslipLine,
} from '../data/entities'
import {
  calculatePayrollSchema,
  createCompensationSchema,
  createIncentiveSchema,
  createLoanSchema,
  createPayrollRunSchema,
  createPenaltySchema,
  updateCompensationSchema,
  updateIncentiveSchema,
  updateLoanSchema,
  updatePayrollRunSchema,
  updatePenaltySchema,
} from '../data/validators'
import { registerCrudCommands } from './crud'
import { makeEvents, makeIndexer, scopeFrom } from './hr'
import { raiseHrError } from '../lib/errors'
import { computePayroll } from '../lib/payrollService'
import {
  divideDecimalByInteger,
  isZeroDecimal,
  multiplyDecimalStrings,
  roundDecimalHalfUp,
  subtractDecimalStrings,
  sumDecimalStrings,
} from '../../financial/lib/money'
import eventsConfig from '../events'

const emitHrEvent = eventsConfig.emit

export const HR_COMPENSATION_ENTITY_ID = 'hr_management:hr_employee_compensation' as const
export const HR_LOAN_ENTITY_ID = 'hr_management:hr_employee_loan' as const
export const HR_LOAN_INSTALMENT_ENTITY_ID = 'hr_management:hr_loan_instalment' as const
export const HR_PENALTY_ENTITY_ID = 'hr_management:hr_employee_penalty' as const
export const HR_INCENTIVE_ENTITY_ID = 'hr_management:hr_employee_incentive' as const
export const HR_PAYROLL_RUN_ENTITY_ID = 'hr_management:hr_payroll_run' as const
export const HR_PAYSLIP_ENTITY_ID = 'hr_management:hr_payslip' as const

const compensationEvents = makeEvents<HrEmployeeCompensation>('employee_compensation')
const compensationIndexer = makeIndexer<HrEmployeeCompensation>(HR_COMPENSATION_ENTITY_ID)
const penaltyEvents = makeEvents<HrEmployeePenalty>('employee_penalty')
const penaltyIndexer = makeIndexer<HrEmployeePenalty>(HR_PENALTY_ENTITY_ID)
const incentiveEvents = makeEvents<HrEmployeeIncentive>('employee_incentive')
const incentiveIndexer = makeIndexer<HrEmployeeIncentive>(HR_INCENTIVE_ENTITY_ID)
const payrollRunEvents = makeEvents<HrPayrollRun>('payroll_run')
const payrollRunIndexer = makeIndexer<HrPayrollRun>(HR_PAYROLL_RUN_ENTITY_ID)
const payslipEvents = makeEvents<HrPayslip>('payslip')
const payslipIndexer = makeIndexer<HrPayslip>(HR_PAYSLIP_ENTITY_ID)

function money(value: string | number): string {
  return roundDecimalHalfUp(value, 2)
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`)
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime())
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

function overlapDays(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): number {
  const from = Math.max(start.getTime(), rangeStart.getTime())
  const to = Math.min(end.getTime(), rangeEnd.getTime())
  if (to < from) return 0
  return Math.floor((to - from) / 86_400_000) + 1
}

registerCrudCommands({
  entity: HrEmployeeCompensation,
  entityId: HR_COMPENSATION_ENTITY_ID,
  resource: 'compensations',
  createSchema: createCompensationSchema,
  updateSchema: updateCompensationSchema,
  toCreateData: (input) => ({
    ...input,
    effectiveFrom: toDate(String(input.effectiveFrom)),
  }),
  toUpdateData: (input) => {
    const { id: _id, effectiveFrom, ...patch } = input
    return {
      ...patch,
      ...(effectiveFrom === undefined ? {} : { effectiveFrom: toDate(String(effectiveFrom)) }),
    }
  },
  events: compensationEvents,
  indexer: compensationIndexer,
})

registerCrudCommands({
  entity: HrEmployeePenalty,
  entityId: HR_PENALTY_ENTITY_ID,
  resource: 'penalties',
  createSchema: createPenaltySchema,
  updateSchema: updatePenaltySchema,
  toCreateData: (input) => ({
    ...input,
    incidentOn: toDate(String(input.incidentOn)),
    amount: input.amount === undefined || input.amount === null ? null : money(String(input.amount)),
  }),
  toUpdateData: (input) => {
    const { id: _id, incidentOn, amount, ...patch } = input
    return {
      ...patch,
      ...(incidentOn === undefined ? {} : { incidentOn: toDate(String(incidentOn)) }),
      ...(amount === undefined ? {} : { amount: amount === null ? null : money(String(amount)) }),
    }
  },
  events: penaltyEvents,
  indexer: penaltyIndexer,
})

registerCrudCommands({
  entity: HrEmployeeIncentive,
  entityId: HR_INCENTIVE_ENTITY_ID,
  resource: 'incentives',
  createSchema: createIncentiveSchema,
  updateSchema: updateIncentiveSchema,
  toCreateData: (input) => ({
    ...input,
    amount: money(String(input.amount)),
    periodStart: input.periodStart ? toDate(String(input.periodStart)) : null,
    periodEnd: input.periodEnd ? toDate(String(input.periodEnd)) : null,
  }),
  toUpdateData: (input) => {
    const { id: _id, amount, periodStart, periodEnd, ...patch } = input
    return {
      ...patch,
      ...(amount === undefined ? {} : { amount: money(String(amount)) }),
      ...(periodStart === undefined ? {} : { periodStart: periodStart ? toDate(String(periodStart)) : null }),
      ...(periodEnd === undefined ? {} : { periodEnd: periodEnd ? toDate(String(periodEnd)) : null }),
    }
  },
  events: incentiveEvents,
  indexer: incentiveIndexer,
})

const createLoanCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.loans.create',
  async execute(raw, ctx) {
    const input = createLoanSchema.parse(raw)
    const scope = scopeFrom(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const loan = await em.transactional(async (trx) => {
      const employee = await trx.findOne(HrEmployee, { id: input.employeeId, ...scope, deletedAt: null })
      if (!employee) return raiseHrError(404, 'employee_not_found', 'The selected employee does not exist.')
      const principal = money(String(input.principalAmount))
      if (isZeroDecimal(principal) || principal.startsWith('-')) {
        return raiseHrError(400, 'invalid_amount', 'The loan amount must be greater than zero.')
      }
      const instalmentAmount = money(divideDecimalByInteger(principal, input.instalmentCount, 6))
      const now = new Date()
      const created = trx.create(HrEmployeeLoan, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        employeeId: input.employeeId,
        principalAmount: principal,
        currencyCode: input.currencyCode.toUpperCase(),
        instalmentCount: input.instalmentCount,
        instalmentAmount,
        firstDueOn: toDate(input.firstDueOn),
        outstandingAmount: principal,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        status: 'pending',
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      trx.persist(created)
      await trx.flush()
      const firstDue = toDate(input.firstDueOn)
      let remaining = principal
      for (let index = 0; index < input.instalmentCount; index += 1) {
        const isLast = index === input.instalmentCount - 1
        const amount = isLast ? money(remaining) : (Number(instalmentAmount) <= Number(remaining) ? instalmentAmount : money(remaining))
        remaining = money(subtractDecimalStrings(remaining, amount))
        trx.persist(trx.create(HrLoanInstalment, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          loanId: created.id,
          sequence: index + 1,
          dueOn: addMonths(firstDue, index),
          amount,
          status: 'scheduled',
          createdAt: now,
          updatedAt: now,
        }))
      }
      await trx.flush()
      return created
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: loan,
      identifiers: { id: loan.id, ...scope },
      actorUserId,
      events: makeEvents<HrEmployeeLoan>('employee_loan'),
      indexer: makeIndexer<HrEmployeeLoan>(HR_LOAN_ENTITY_ID),
    })
    return { id: loan.id }
  },
}

const updateLoanCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.loans.update',
  async execute(raw, ctx) {
    const input = updateLoanSchema.parse(raw)
    const scope = scopeFrom(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const loan = await em.findOne(HrEmployeeLoan, { id: input.id, ...scope, deletedAt: null })
    if (!loan) return raiseHrError(404, 'record_not_found', 'Record not found.')
    if (loan.status !== 'pending') return raiseHrError(409, 'record_not_editable', 'Only a pending loan can be edited.')
    Object.assign(loan, {
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      updatedAt: new Date(),
    })
    await em.flush()
    return { id: loan.id }
  },
}

const deleteLoanCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.loans.delete',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = scopeFrom(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const loan = await em.findOne(HrEmployeeLoan, { id: input.id, ...scope, deletedAt: null })
    if (!loan) return raiseHrError(404, 'record_not_found', 'Record not found.')
    if (loan.status !== 'pending') return raiseHrError(409, 'record_not_editable', 'Only a pending loan can be deleted.')
    loan.deletedAt = new Date()
    loan.updatedAt = new Date()
    await em.nativeDelete(HrLoanInstalment, { loanId: loan.id })
    await em.flush()
    return { id: loan.id }
  },
}

const createPayrollRunCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.payroll_runs.create',
  async execute(raw, ctx) {
    const input = createPayrollRunSchema.parse(raw)
    const scope = scopeFrom(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const run = em.create(HrPayrollRun, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      periodStart: toDate(input.periodStart),
      periodEnd: toDate(input.periodEnd),
      paymentDate: toDate(input.paymentDate),
      currencyCode: input.currencyCode.toUpperCase(),
      status: 'draft',
      notes: input.notes ?? null,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    await em.persist(run).flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: run,
      identifiers: { id: run.id, ...scope },
      actorUserId,
      events: payrollRunEvents,
      indexer: payrollRunIndexer,
    })
    return { id: run.id }
  },
}

const updatePayrollRunCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.payroll_runs.update',
  async execute(raw, ctx) {
    const input = updatePayrollRunSchema.parse(raw)
    const scope = scopeFrom(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(HrPayrollRun, { id: input.id, ...scope, deletedAt: null })
    if (!run) return raiseHrError(404, 'record_not_found', 'Record not found.')
    if (run.status !== 'draft') return raiseHrError(409, 'record_not_editable', 'Only a draft payroll run can be edited.')
    if (input.paymentDate) run.paymentDate = toDate(input.paymentDate)
    if (input.notes !== undefined) run.notes = input.notes
    run.updatedAt = new Date()
    await em.flush()
    return { id: run.id }
  },
}

const deletePayrollRunCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.payroll_runs.delete',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = scopeFrom(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(HrPayrollRun, { id: input.id, ...scope, deletedAt: null })
    if (!run) return raiseHrError(404, 'record_not_found', 'Record not found.')
    if (run.status !== 'draft') return raiseHrError(409, 'record_not_editable', 'Only a draft payroll run can be deleted.')
    run.deletedAt = new Date()
    run.updatedAt = new Date()
    await em.flush()
    return { id: run.id }
  },
}

type PayrollComputationResult = { employeeCount: number; grossTotal: string; deductionTotal: string; netTotal: string }

async function calculateRun(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  run: HrPayrollRun,
  deductionCeilingShare: number,
): Promise<PayrollComputationResult> {
  const previousPayslips = await em.find(HrPayslip, { payrollRunId: run.id })
  if (previousPayslips.length > 0) {
    await em.nativeDelete(HrPayslipLine, {
      payslipId: { $in: previousPayslips.map((payslip) => payslip.id) },
    })
  }
  await em.nativeDelete(HrPayslip, { payrollRunId: run.id })

  const periodStart = run.periodStart
  const periodEnd = run.periodEnd
  const employees = await em.find(HrEmployee, {
    ...scope,
    deletedAt: null,
    status: { $in: ['active', 'on_leave'] },
  })
  const employeeIds = employees.map((employee) => employee.id)
  if (employeeIds.length === 0) {
    return { employeeCount: 0, grossTotal: '0.00', deductionTotal: '0.00', netTotal: '0.00' }
  }

  const compensations = await em.find(HrEmployeeCompensation, {
    ...scope,
    deletedAt: null,
    employeeId: { $in: employeeIds },
    effectiveFrom: { $lte: periodEnd },
  }, { orderBy: { effectiveFrom: 'asc' } })
  const compensationByEmployee = new Map<string, HrEmployeeCompensation>()
  for (const row of compensations) compensationByEmployee.set(row.employeeId, row)

  const leaveRequests = await em.find(HrLeaveRequest, {
    ...scope,
    deletedAt: null,
    employeeId: { $in: employeeIds },
    status: 'approved',
    leaveType: 'unpaid',
    startDate: { $lte: periodEnd },
    endDate: { $gte: periodStart },
  })
  const unpaidLeaveByEmployee = new Map<string, number>()
  for (const leave of leaveRequests) {
    const days = overlapDays(leave.startDate, leave.endDate, periodStart, periodEnd)
    unpaidLeaveByEmployee.set(leave.employeeId, (unpaidLeaveByEmployee.get(leave.employeeId) ?? 0) + days)
  }

  const attendance = await em.find(HrAttendanceRecord, {
    ...scope,
    deletedAt: null,
    employeeId: { $in: employeeIds },
    status: 'absent',
    date: { $gte: periodStart, $lte: periodEnd },
  })
  const absenceByEmployee = new Map<string, number>()
  for (const record of attendance) {
    absenceByEmployee.set(record.employeeId, (absenceByEmployee.get(record.employeeId) ?? 0) + 1)
  }

  const penalties = await em.find(HrEmployeePenalty, {
    ...scope,
    deletedAt: null,
    employeeId: { $in: employeeIds },
    status: 'approved',
    payrollRunId: null,
    incidentOn: { $gte: periodStart, $lte: periodEnd },
  })
  const incentives = await em.find(HrEmployeeIncentive, {
    ...scope,
    deletedAt: null,
    employeeId: { $in: employeeIds },
    status: 'approved',
    payrollRunId: null,
  })
  const instalments = await em.find(HrLoanInstalment, {
    ...scope,
    status: 'scheduled',
    dueOn: { $gte: periodStart, $lte: periodEnd },
  })
  const loans = await em.find(HrEmployeeLoan, {
    ...scope,
    deletedAt: null,
    id: { $in: [...new Set(instalments.map((instalment) => instalment.loanId))] },
  })
  const loanById = new Map(loans.map((loan) => [loan.id, loan]))

  let grossTotal = '0.00'
  let deductionTotal = '0.00'
  let netTotal = '0.00'
  let employeeCount = 0

  for (const employee of employees) {
    const compensation = compensationByEmployee.get(employee.id)
    if (!compensation) continue
    const employeePenalties = penalties.filter((penalty) => penalty.employeeId === employee.id && penalty.penaltyType === 'deduction' && penalty.amount)
    const employeeIncentives = incentives.filter((incentive) => incentive.employeeId === employee.id)
    const employeeInstalments = instalments.filter((instalment) => loanById.get(instalment.loanId)?.employeeId === employee.id
      && ['approved', 'settling'].includes(loanById.get(instalment.loanId)?.status ?? ''))
    const computation = computePayroll({
      compensation: {
        basicSalary: compensation.basicSalary,
        housingAllowance: compensation.housingAllowance,
        transportAllowance: compensation.transportAllowance,
        otherAllowance: compensation.otherAllowance,
      },
      unpaidLeaveDays: unpaidLeaveByEmployee.get(employee.id) ?? 0,
      absenceDays: absenceByEmployee.get(employee.id) ?? 0,
      overtimeAmount: '0',
      incentives: employeeIncentives.map((incentive) => ({
        id: incentive.id,
        label: incentive.reason,
        amount: incentive.amount,
      })),
      penalties: employeePenalties.map((penalty) => ({
        id: penalty.id,
        label: penalty.reason,
        amount: penalty.amount as string,
      })),
      loanInstalments: employeeInstalments.map((instalment) => ({
        id: instalment.id,
        label: `Loan instalment ${instalment.sequence}`,
        amount: instalment.amount,
      })),
      deductionCeilingShare,
    })

    const payslip = em.create(HrPayslip, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      payrollRunId: run.id,
      employeeId: employee.id,
      grossAmount: computation.grossAmount,
      deductionAmount: computation.deductionAmount,
      netAmount: computation.netAmount,
      status: 'draft',
      workedDays: '0',
      paidLeaveDays: '0',
      unpaidLeaveDays: String(unpaidLeaveByEmployee.get(employee.id) ?? 0),
      absenceDays: String(absenceByEmployee.get(employee.id) ?? 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(payslip)
    await em.flush()
    computation.lines.forEach((line, index) => {
      em.persist(em.create(HrPayslipLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        payslipId: payslip.id,
        kind: line.kind,
        code: line.code,
        label: line.label,
        amount: line.amount,
        sourceEntityType: line.sourceEntityType ?? null,
        sourceEntityId: line.sourceEntityId ?? null,
        sequence: index + 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    })
    await em.flush()
    grossTotal = money(sumDecimalStrings([grossTotal, computation.grossAmount]))
    deductionTotal = money(sumDecimalStrings([deductionTotal, computation.deductionAmount]))
    netTotal = money(sumDecimalStrings([netTotal, computation.netAmount]))
    employeeCount += 1
  }

  return { employeeCount, grossTotal, deductionTotal, netTotal }
}

const calculatePayrollRunCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.payroll_runs.calculate',
  async execute(raw, ctx) {
    const input = calculatePayrollSchema.parse(raw)
    const scope = scopeFrom(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.transactional(async (trx) => {
      const current = await trx.findOne(HrPayrollRun, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!current) return raiseHrError(404, 'record_not_found', 'Record not found.')
      if (current.status !== 'draft' && current.status !== 'calculated') {
        return raiseHrError(409, 'record_not_editable', 'Only a draft or calculated payroll run can be recalculated.')
      }
      const totals = await calculateRun(trx, scope, current, input.deductionCeilingShare ?? 0)
      current.grossTotal = totals.grossTotal
      current.deductionTotal = totals.deductionTotal
      current.netTotal = totals.netTotal
      current.employeeCount = totals.employeeCount
      current.status = 'calculated'
      current.calculatedAt = new Date()
      current.updatedAt = new Date()
      await trx.flush()
      return current
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: run,
      identifiers: { id: run.id, ...scope },
      actorUserId,
      events: payrollRunEvents,
      indexer: payrollRunIndexer,
    })
    return { id: run.id }
  },
}

const submitPayrollRunCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.payroll_runs.submit',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = scopeFrom(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(HrPayrollRun, { id: input.id, ...scope, deletedAt: null })
    if (!run) return raiseHrError(404, 'record_not_found', 'Record not found.')
    if (run.status !== 'calculated') return raiseHrError(409, 'record_not_editable', 'Only a calculated payroll run can be submitted.')
    const workflow = await em.findOne(HrApprovalWorkflow, {
      ...scope,
      deletedAt: null,
      entityType: 'hr_payroll_run',
      isActive: true,
    })
    if (!workflow) return raiseHrError(400, 'payroll_workflow_missing', 'Configure an active approval workflow for payroll runs.')
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      Record<string, unknown>,
      { approvalRequestId: string }
    >('hr_management.approvals.submit', {
      input: {
        workflowId: workflow.id,
        entityType: 'hr_payroll_run',
        entityId: run.id,
        summary: `Payroll ${run.periodStart.toISOString().slice(0, 10)} – ${run.periodEnd.toISOString().slice(0, 10)}`,
        payload: { employeeId: null },
      },
      ctx,
    })
    run.approvalRequestId = result.approvalRequestId
    run.status = 'submitted'
    run.updatedAt = new Date()
    await em.flush()
    return { id: run.id, approvalRequestId: result.approvalRequestId }
  },
}

const closePayrollRunCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'hr_management.payroll_runs.close',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = scopeFrom(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.transactional(async (trx) => {
      const current = await trx.findOne(HrPayrollRun, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!current) return raiseHrError(404, 'record_not_found', 'Record not found.')
      if (current.status !== 'calculated' && current.status !== 'approved') {
        return raiseHrError(409, 'record_not_editable', 'Only a calculated or approved payroll run can be closed.')
      }
      const payslips = await trx.find(HrPayslip, { payrollRunId: current.id })
      for (const payslip of payslips) {
        const lines = await trx.find(HrPayslipLine, { payslipId: payslip.id })
        for (const line of lines) {
          if (!line.sourceEntityId || !line.sourceEntityType) continue
          if (line.sourceEntityType === 'hr_loan_instalment') {
            const instalment = await trx.findOne(HrLoanInstalment, {
              id: line.sourceEntityId,
              ...scope,
            }, { lockMode: LockMode.PESSIMISTIC_WRITE })
            if (!instalment || instalment.status !== 'scheduled') continue
            instalment.status = 'deducted'
            instalment.payrollRunId = current.id
            instalment.payslipId = payslip.id
            instalment.updatedAt = new Date()
            const loan = await trx.findOne(HrEmployeeLoan, {
              id: instalment.loanId,
              ...scope,
            }, { lockMode: LockMode.PESSIMISTIC_WRITE })
            if (loan) {
              loan.outstandingAmount = money(subtractDecimalStrings(loan.outstandingAmount, line.amount))
              loan.status = isZeroDecimal(loan.outstandingAmount) ? 'settled' : 'settling'
              loan.updatedAt = new Date()
            }
          }
          if (line.sourceEntityType === 'hr_employee_penalty') {
            await trx.nativeUpdate(HrEmployeePenalty, { id: line.sourceEntityId, ...scope }, {
              payrollRunId: current.id,
              payslipId: payslip.id,
              updatedAt: new Date(),
            })
          }
          if (line.sourceEntityType === 'hr_employee_incentive') {
            await trx.nativeUpdate(HrEmployeeIncentive, { id: line.sourceEntityId, ...scope }, {
              payrollRunId: current.id,
              payslipId: payslip.id,
              updatedAt: new Date(),
            })
          }
        }
        payslip.status = 'paid'
        payslip.updatedAt = new Date()
      }
      current.status = 'closed'
      current.updatedAt = new Date()
      await trx.flush()
      return current
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: run,
      identifiers: { id: run.id, ...scope },
      actorUserId,
      events: payrollRunEvents,
      indexer: payrollRunIndexer,
    })
    await emitHrEvent('hr_management.payroll_run.closed', {
      id: run.id,
      periodStart: run.periodStart.toISOString().slice(0, 10),
      periodEnd: run.periodEnd.toISOString().slice(0, 10),
      paymentDate: run.paymentDate.toISOString().slice(0, 10),
      currencyCode: run.currencyCode,
      grossTotal: run.grossTotal,
      deductionTotal: run.deductionTotal,
      netTotal: run.netTotal,
      employeeCount: run.employeeCount,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { id: run.id }
  },
}

registerCommand(createLoanCommand)
registerCommand(updateLoanCommand)
registerCommand(deleteLoanCommand)
registerCommand(createPayrollRunCommand)
registerCommand(updatePayrollRunCommand)
registerCommand(deletePayrollRunCommand)
registerCommand(calculatePayrollRunCommand)
registerCommand(submitPayrollRunCommand)
registerCommand(closePayrollRunCommand)
