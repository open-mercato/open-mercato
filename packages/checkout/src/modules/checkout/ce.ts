import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { CHECKOUT_ENTITY_IDS } from './lib/constants'

export const entities: CustomEntitySpec[] = [
  {
    id: CHECKOUT_ENTITY_IDS.link,
    label: 'Pay Link',
    description: 'Custom fields for pay links',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: CHECKOUT_ENTITY_IDS.template,
    label: 'Link Template',
    description: 'Custom fields for checkout link templates',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: CHECKOUT_ENTITY_IDS.transaction,
    label: 'Checkout Transaction',
    description: 'Custom fields for checkout transactions',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
