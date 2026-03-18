import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'

export const entities = [
  {
    id: PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID,
    label: 'Payment Link Page',
    description: 'Custom metadata fieldsets used when creating hosted pay-by-link pages.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
