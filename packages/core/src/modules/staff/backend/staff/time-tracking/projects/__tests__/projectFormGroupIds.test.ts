import { CrudFormInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import {
  createProjectFormGroups,
  PROJECT_FORM_COMPACT_GROUP_IDS,
  PROJECT_FORM_GROUP_IDS,
} from '../projectFormConfig'

const translate = (key: string, fallback?: string) => fallback ?? key

describe('project form group ids', () => {
  it('renders the published group ids in the published order', () => {
    const groups = createProjectFormGroups(translate)
    expect(groups.map((group) => group.id)).toEqual([...PROJECT_FORM_GROUP_IDS])
  })

  it('renders the published compact group ids for dialog hosts', () => {
    const groups = createProjectFormGroups(translate, { compact: true })
    expect(groups.map((group) => group.id)).toEqual([...PROJECT_FORM_COMPACT_GROUP_IDS])
  })

  it('addresses every group through the project form crud-form host', () => {
    const entityId = extensionPoints.hosts.projectForm.entityId
    expect(PROJECT_FORM_GROUP_IDS.map((groupId) => CrudFormInjectionSpots.group(entityId, groupId))).toEqual([
      'crud-form:staff.staff_time_project:group:basics',
      'crud-form:staff.staff_time_project:group:billing',
      'crud-form:staff.staff_time_project:group:budget',
      'crud-form:staff.staff_time_project:group:status',
      'crud-form:staff.staff_time_project:group:team',
      'crud-form:staff.staff_time_project:group:rounding',
      'crud-form:staff.staff_time_project:group:details',
    ])
  })
})
