import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['student_transport.*'],
    admin: ['student_transport.*', 'customers.companies.view', 'customers.people.view'],
    employee: ['student_transport.read', 'student_transport.attendance.record'],
  },
}

export default setup
