import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { cf } from '@open-mercato/shared/modules/dsl'
import { REFERENCE_TASK_ENTITY_ID } from './data/entity-id'

export const referenceTaskCustomFields = [
  cf.text('source', {
    filterable: true,
    formEditable: true,
    indexed: true,
    listVisible: true,
  }),
]

export const entities: CustomEntitySpec[] = [
  {
    id: REFERENCE_TASK_ENTITY_ID,
    labelField: 'title',
    showInSidebar: false,
    fields: referenceTaskCustomFields,
  },
]

export default entities
