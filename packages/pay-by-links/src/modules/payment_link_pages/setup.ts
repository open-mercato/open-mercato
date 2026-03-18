import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { cf } from '@open-mercato/shared/modules/dsl'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'

const PAYMENT_LINK_PAGE_FIELD_SETS = [
  {
    entity: PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID,
    fields: [
      cf.text('support_email', {
        label: 'Support email',
        description: 'Contact email displayed on the payment page for customer inquiries.',
      }),
      cf.text('company_name', {
        label: 'Company name',
        description: 'Legal company name shown on the payment page and receipts.',
      }),
      cf.text('invoice_number', {
        label: 'Invoice number',
        description: 'Reference invoice or document number linked to this payment.',
        filterable: true,
      }),
      cf.text('order_reference', {
        label: 'Order reference',
        description: 'External order or PO number for the customer to verify.',
        filterable: true,
      }),
      cf.multiline('payment_instructions', {
        label: 'Payment instructions',
        description: 'Additional instructions or notes displayed to the customer before payment.',
        listVisible: false,
      }),
      cf.select('payment_purpose', ['invoice', 'deposit', 'subscription', 'donation', 'service_fee', 'other'], {
        label: 'Payment purpose',
        description: 'Category of the payment for reporting and display.',
        filterable: true,
      }),
    ],
  },
]

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['payment_link_pages.templates.*'],
    admin: ['payment_link_pages.templates.*'],
    employee: ['payment_link_pages.templates.view'],
  },

  seedDefaults: async (ctx) => {
    await ensureCustomFieldDefinitions(
      ctx.em,
      PAYMENT_LINK_PAGE_FIELD_SETS,
      { organizationId: null, tenantId: ctx.tenantId },
    )
  },
}

export default setup
