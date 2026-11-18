import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '#generated/entities.ids.generated'

export const entities: CustomEntitySpec[] = [
  {
    id: E.property_management.building,
    label: 'Building',
    description: 'A building managed in Property Management.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.property_management.unit,
    label: 'Unit',
    description: 'A leasable or bookable unit on a floor.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.property_management.lease,
    label: 'Lease',
    description: 'A lease of a unit.',
    labelField: 'reference',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
