/**
 * The HR entities an approval workflow can be declared for.
 *
 * `entityType` is a free string in the schema and the engine decides what to do by comparing it, so a
 * typo produces a workflow that is never selected and never complains — the request is simply refused
 * with "no workflow" or submitted against a definition that changes nothing. Offering exactly the
 * targets the engine implements is what keeps the list honest; an unrecognized stored value still
 * renders as itself so a row from an older definition stays readable.
 */

export type ApprovalTargetOption = {
  value: string
  labelKey: string
  fallbackLabel: string
}

export const HR_APPROVAL_TARGETS: ApprovalTargetOption[] = [
  {
    value: 'hr_leave_request',
    labelKey: 'hr_management.approvals.targets.leaveRequest',
    fallbackLabel: 'Leave request',
  },
  {
    value: 'hr_attendance_record',
    labelKey: 'hr_management.approvals.targets.attendanceRecord',
    fallbackLabel: 'Attendance record',
  },
  {
    value: 'hr_employee_loan',
    labelKey: 'hr_management.approvals.targets.employeeLoan',
    fallbackLabel: 'Employee loan',
  },
  {
    value: 'hr_employee_penalty',
    labelKey: 'hr_management.approvals.targets.employeePenalty',
    fallbackLabel: 'Employee penalty',
  },
  {
    value: 'hr_employee_incentive',
    labelKey: 'hr_management.approvals.targets.employeeIncentive',
    fallbackLabel: 'Employee incentive',
  },
  {
    value: 'hr_payroll_run',
    labelKey: 'hr_management.approvals.targets.payrollRun',
    fallbackLabel: 'Payroll run',
  },
  {
    value: 'fleet_vehicle_assignment',
    labelKey: 'hr_management.approvals.targets.fleetAssignment',
    fallbackLabel: 'Fleet vehicle custody',
  },
]

/** The label for a stored `entityType`, falling back to the raw value for an unknown target. */
export function resolveApprovalTargetLabel(
  entityType: string | null | undefined,
  translate: (key: string, fallback: string) => string,
): string {
  if (!entityType) return '—'
  const known = HR_APPROVAL_TARGETS.find((target) => target.value === entityType)
  return known ? translate(known.labelKey, known.fallbackLabel) : entityType
}
