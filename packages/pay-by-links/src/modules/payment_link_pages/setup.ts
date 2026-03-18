import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { cf } from '@open-mercato/shared/modules/dsl'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'
import { CustomFieldEntityConfig } from '@open-mercato/core/modules/entities/data/entities'

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

const CUSTOMER_QUESTION_FIELDS = [
  {
    entity: PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID,
    fields: [
      // B2B questionnaire fields
      cf.text('buyer_company', {
        label: 'Company name',
        description: 'Your company name for the invoice.',
        fieldset: 'b2b_questions',
        validation: [{ rule: 'required' }],
      }),
      cf.text('buyer_vat', {
        label: 'VAT number',
        description: 'EU VAT identification number.',
        fieldset: 'b2b_questions',
      }),
      cf.text('buyer_po_number', {
        label: 'PO number',
        description: 'Your purchase order reference.',
        fieldset: 'b2b_questions',
      }),
      cf.text('buyer_department', {
        label: 'Department',
        description: 'Department or cost center for billing.',
        fieldset: 'b2b_questions',
      }),
      cf.multiline('buyer_notes', {
        label: 'Notes',
        description: 'Any additional notes or requests.',
        fieldset: 'b2b_questions',
      }),

      // T-shirt configurator fields
      cf.select('tshirt_size', ['XS', 'S', 'M', 'L', 'XL', 'XXL'], {
        label: 'T-shirt size',
        description: 'Select your size.',
        fieldset: 'tshirt_config',
        validation: [{ rule: 'required' }],
      }),
      cf.text('tshirt_caption', {
        label: 'Caption text',
        description: 'Custom text printed on the t-shirt (max 30 characters).',
        fieldset: 'tshirt_config',
        validation: [{ rule: 'required' }],
      }),
      cf.select('tshirt_color', ['white', 'black', 'navy', 'red', 'gray'], {
        label: 'T-shirt color',
        description: 'Base color of the t-shirt.',
        fieldset: 'tshirt_config',
        validation: [{ rule: 'required' }],
      }),
      cf.select('tshirt_print_position', ['front', 'back', 'both'], {
        label: 'Print position',
        description: 'Where the caption is printed.',
        fieldset: 'tshirt_config',
      }),
    ],
  },
]

async function ensureFieldsetConfig(em: EntityManager, tenantId: string) {
  const existing = await em.findOne(CustomFieldEntityConfig, {
    entityId: PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID,
    tenantId,
    organizationId: null,
  })

  const fieldsets = [
    { code: 'b2b_questions', label: 'B2B Buyer Questions', icon: 'building', description: 'Capture company details and billing preferences from business customers.' },
    { code: 'tshirt_config', label: 'T-Shirt Configurator', icon: 'shirt', description: 'Collect size, color, and caption for custom t-shirt orders.' },
  ]

  if (existing) {
    const config = (existing.configJson ?? {}) as Record<string, unknown>
    const existingFieldsets = Array.isArray(config.fieldsets) ? config.fieldsets as Array<{ code: string }> : []
    const existingCodes = new Set(existingFieldsets.map(fs => fs.code))
    const newFieldsets = fieldsets.filter(fs => !existingCodes.has(fs.code))
    if (newFieldsets.length > 0) {
      existing.configJson = { ...config, fieldsets: [...existingFieldsets, ...newFieldsets], singleFieldsetPerRecord: true }
    }
  } else {
    const cfg = new CustomFieldEntityConfig()
    cfg.entityId = PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID
    cfg.tenantId = tenantId
    cfg.organizationId = null
    cfg.configJson = { fieldsets, singleFieldsetPerRecord: true }
    em.persist(cfg)
  }
  await em.flush()
}

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

  seedExamples: async (ctx) => {
    // Seed customer-facing fieldsets and their field definitions
    await ensureFieldsetConfig(ctx.em, ctx.tenantId)
    await ensureCustomFieldDefinitions(
      ctx.em,
      CUSTOMER_QUESTION_FIELDS,
      { organizationId: null, tenantId: ctx.tenantId },
    )

    // Seed example templates
    const { createCrud } = await import('@open-mercato/ui/backend/utils/crud')

    const b2bTemplate = {
      name: 'B2B Invoice Payment',
      description: 'Payment link template for B2B transactions with company details capture.',
      isDefault: false,
      amountType: 'fixed',
      branding: { brandName: null, logoUrl: null, securitySubtitle: null, accentColor: null, customCss: null },
      defaultTitle: 'Business Payment',
      defaultDescription: 'Complete your payment for the issued invoice. Please provide your company details for proper invoicing.',
      customerCapture: {
        enabled: true,
        customerHandlingMode: 'create_new',
        companyRequired: true,
        termsRequired: false,
        termsMarkdown: null,
        fields: {
          firstName: { visible: true, required: true },
          lastName: { visible: true, required: true },
          phone: { visible: true, required: false },
          companyName: { visible: true, required: true },
          address: { visible: true, required: true, format: 'street_first' },
        },
      },
      customerFieldsetCode: 'b2b_questions',
      displayCustomFields: true,
      customFieldsetCode: null,
      customFields: null,
      metadata: null,
    }

    const tshirtTemplate = {
      name: 'Custom T-Shirt Order',
      description: 'Payment link for custom t-shirt orders with size and caption selection.',
      isDefault: false,
      amountType: 'predefined',
      amountOptions: [
        { amount: 19.99, label: 'Standard T-Shirt' },
        { amount: 29.99, label: 'Premium T-Shirt' },
        { amount: 49.99, label: 'Premium T-Shirt + Express Shipping' },
      ],
      branding: { brandName: null, logoUrl: null, securitySubtitle: null, accentColor: null, customCss: null },
      defaultTitle: 'Custom T-Shirt Order',
      defaultDescription: 'Configure your custom t-shirt and complete the payment.',
      customerCapture: {
        enabled: true,
        customerHandlingMode: 'create_new',
        companyRequired: false,
        termsRequired: false,
        termsMarkdown: null,
        fields: {
          firstName: { visible: true, required: true },
          lastName: { visible: true, required: true },
          phone: { visible: false, required: false },
          companyName: { visible: false, required: false },
          address: { visible: true, required: true, format: 'line_first' },
        },
      },
      customerFieldsetCode: 'tshirt_config',
      displayCustomFields: false,
      customFieldsetCode: null,
      customFields: null,
      metadata: null,
    }

    try {
      await createCrud('payment_link_pages/templates', b2bTemplate)
    } catch { /* template may already exist */ }
    try {
      await createCrud('payment_link_pages/templates', tshirtTemplate)
    } catch { /* template may already exist */ }
  },
}

export default setup
