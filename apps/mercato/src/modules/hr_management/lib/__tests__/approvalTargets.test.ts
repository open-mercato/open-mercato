/** @jest-environment node */
/**
 * Pins how a workflow's `entityType` is presented and chosen.
 *
 * The schema stores it as a free string and the engine compares it, so the UI is the only thing
 * standing between an operator and a definition that is never selected. The known targets get
 * translated labels; an unknown stored value renders as itself rather than as a blank cell, because
 * a workflow someone else's integration created must still be readable in the list.
 */
import { HR_APPROVAL_TARGETS, resolveApprovalTargetLabel } from '../approvalTargets'

const translate = (key: string, fallback: string) => `${key}:${fallback}`

describe('approval targets', () => {
  it('offers exactly the targets the engine implements', () => {
    expect(HR_APPROVAL_TARGETS.map((target) => target.value)).toEqual([
      'hr_leave_request',
      'hr_attendance_record',
      'hr_employee_loan',
      'hr_employee_penalty',
      'hr_employee_incentive',
      'hr_payroll_run',
      'fleet_vehicle_assignment',
    ])
  })

  it('translates a known target', () => {
    expect(resolveApprovalTargetLabel('hr_leave_request', translate))
      .toBe('hr_management.approvals.targets.leaveRequest:Leave request')
    expect(resolveApprovalTargetLabel('hr_attendance_record', translate))
      .toBe('hr_management.approvals.targets.attendanceRecord:Attendance record')
  })

  it('shows an unknown target as itself instead of hiding it', () => {
    expect(resolveApprovalTargetLabel('wms_transfer', translate)).toBe('wms_transfer')
  })

  it('shows a dash when the target is absent', () => {
    expect(resolveApprovalTargetLabel(null, translate)).toBe('—')
    expect(resolveApprovalTargetLabel(undefined, translate)).toBe('—')
  })
})
