import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '#generated/entities.ids.generated'
import { STAFF_TEAM_MEMBER_CUSTOM_FIELDS } from './lib/customFields'

const systemEntities: CustomEntitySpec[] = [
  {
    id: E.staff.staff_team_member,
    label: 'Employee',
    description: 'Employees who can be scheduled on worktime plans.',
    labelField: 'displayName',
    showInSidebar: false,
    fields: STAFF_TEAM_MEMBER_CUSTOM_FIELDS,
  },
]

export const entities = systemEntities
export default systemEntities
