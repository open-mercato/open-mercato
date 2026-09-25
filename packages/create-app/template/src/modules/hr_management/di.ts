import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  HrDepartment,
  HrEmployee,
  HrDriverProfile,
  HrAttendanceRecord,
  HrLeaveRequest,
  HrEmployeeDocument,
  HrApprovalWorkflow,
  HrApprovalStepDefinition,
  HrApprovalRequest,
  HrApprovalActionLog,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    HrDepartment: asValue(HrDepartment),
    HrEmployee: asValue(HrEmployee),
    HrDriverProfile: asValue(HrDriverProfile),
    HrAttendanceRecord: asValue(HrAttendanceRecord),
    HrLeaveRequest: asValue(HrLeaveRequest),
    HrEmployeeDocument: asValue(HrEmployeeDocument),
    HrApprovalWorkflow: asValue(HrApprovalWorkflow),
    HrApprovalStepDefinition: asValue(HrApprovalStepDefinition),
    HrApprovalRequest: asValue(HrApprovalRequest),
    HrApprovalActionLog: asValue(HrApprovalActionLog),
  })
}
