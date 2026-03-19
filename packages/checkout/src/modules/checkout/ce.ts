import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'

export const entities: CustomEntitySpec[] = [
  {
    id: 'checkout:link',
    label: 'Pay Link',
    description: 'Custom fields for pay links',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'checkout:template',
    label: 'Link Template',
    description: 'Custom fields for checkout link templates',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'checkout:transaction',
    label: 'Checkout Transaction',
    description: 'Custom fields for checkout transactions',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
