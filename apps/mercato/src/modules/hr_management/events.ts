import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * The HR module's declared events.
 *
 * CRUD families are emitted by the side-effect emitter; the payroll lifecycle
 * events are the ones a consumer should follow, because `updated` also fires for
 * a draft edit while `closed` means the payslips and their source records were
 * consumed in one transaction.
 */
const events = [
  { id: 'hr_management.employee_compensation.created', label: 'Compensation Created', entity: 'employee_compensation', category: 'crud' },
  { id: 'hr_management.employee_compensation.updated', label: 'Compensation Updated', entity: 'employee_compensation', category: 'crud' },
  { id: 'hr_management.employee_compensation.deleted', label: 'Compensation Deleted', entity: 'employee_compensation', category: 'crud' },
  { id: 'hr_management.employee_loan.created', label: 'Employee Loan Created', entity: 'employee_loan', category: 'crud' },
  { id: 'hr_management.employee_loan.updated', label: 'Employee Loan Updated', entity: 'employee_loan', category: 'crud' },
  { id: 'hr_management.employee_loan.deleted', label: 'Employee Loan Deleted', entity: 'employee_loan', category: 'crud' },
  { id: 'hr_management.employee_penalty.created', label: 'Employee Penalty Created', entity: 'employee_penalty', category: 'crud' },
  { id: 'hr_management.employee_penalty.updated', label: 'Employee Penalty Updated', entity: 'employee_penalty', category: 'crud' },
  { id: 'hr_management.employee_penalty.deleted', label: 'Employee Penalty Deleted', entity: 'employee_penalty', category: 'crud' },
  { id: 'hr_management.employee_incentive.created', label: 'Employee Incentive Created', entity: 'employee_incentive', category: 'crud' },
  { id: 'hr_management.employee_incentive.updated', label: 'Employee Incentive Updated', entity: 'employee_incentive', category: 'crud' },
  { id: 'hr_management.employee_incentive.deleted', label: 'Employee Incentive Deleted', entity: 'employee_incentive', category: 'crud' },
  { id: 'hr_management.payroll_run.created', label: 'Payroll Run Created', entity: 'payroll_run', category: 'crud' },
  { id: 'hr_management.payroll_run.updated', label: 'Payroll Run Updated', entity: 'payroll_run', category: 'crud' },
  { id: 'hr_management.payroll_run.deleted', label: 'Payroll Run Deleted', entity: 'payroll_run', category: 'crud' },
  { id: 'hr_management.payslip.created', label: 'Payslip Created', entity: 'payslip', category: 'crud' },
  { id: 'hr_management.payslip.updated', label: 'Payslip Updated', entity: 'payslip', category: 'crud' },
  { id: 'hr_management.payslip.deleted', label: 'Payslip Deleted', entity: 'payslip', category: 'crud' },
  { id: 'hr_management.leave_entitlement.created', label: 'Leave Entitlement Created', entity: 'leave_entitlement', category: 'crud' },
  { id: 'hr_management.leave_entitlement.updated', label: 'Leave Entitlement Updated', entity: 'leave_entitlement', category: 'crud' },
  { id: 'hr_management.leave_entitlement.deleted', label: 'Leave Entitlement Deleted', entity: 'leave_entitlement', category: 'crud' },
  {
    id: 'hr_management.leave_accrual.run',
    label: 'Leave Accrual Run',
    description: 'A monthly accrual run credited the entitlements it covers. Re-running the same month is a no-op.',
    entity: 'leave_accrual',
    category: 'lifecycle',
  },
  {
    id: 'hr_management.payroll_run.approved',
    label: 'Payroll Run Approved',
    description: 'The final approval step accepted the payroll run. The run is frozen from here.',
    entity: 'payroll_run',
    category: 'lifecycle',
  },
  {
    id: 'hr_management.payroll_run.closed',
    label: 'Payroll Run Closed',
    description: 'Payslips are paid and every loan instalment, penalty and incentive they consumed is marked. A ledger consumer should post this event, not the generic update.',
    entity: 'payroll_run',
    category: 'lifecycle',
  },
  {
    id: 'hr_management.approval_request.decided',
    label: 'Approval Request Decided',
    description: 'The final approval step accepted or rejected the target record. Consumers outside HR (fleet custody, for example) apply their side of the decision.',
    entity: 'approval_request',
    category: 'lifecycle',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'hr_management',
  events,
})

export const emitHrEvent = eventsConfig.emit
export type HrEventId = (typeof events)[number]['id']

export default eventsConfig
