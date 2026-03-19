import type { EntityManager } from '@mikro-orm/postgresql'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { CheckoutLink, CheckoutLinkTemplate } from '../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../lib/defaults'
import { toMoneyString, toTemplateOrLinkMutationInput } from '../lib/utils'

type TemplateSeed = {
  name: string
  title: string
  subtitle: string
  description: string
  pricingMode: CheckoutLinkTemplate['pricingMode']
  fixedPriceAmount?: number | null
  fixedPriceCurrencyCode?: string | null
  customAmountMin?: number | null
  customAmountMax?: number | null
  customAmountCurrencyCode?: string | null
  priceListItems?: Array<{ id: string; description: string; amount: number; currencyCode: string }>
  maxCompletions?: number | null
  collectCustomerDetails?: boolean
  customFields?: Record<string, unknown>
}

type LinkSeed = {
  templateName: string
  name: string
  title: string
  subtitle: string
  description: string
  slug: string
  customFields?: Record<string, unknown>
}

const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    name: 'Consulting Fee',
    title: 'Consulting session payment',
    subtitle: 'One-hour consulting session',
    description: '## Included\n\n- 60 minute strategy call\n- Summary and next steps\n- Single-use payment request',
    pricingMode: 'fixed',
    fixedPriceAmount: 150,
    fixedPriceCurrencyCode: 'USD',
    maxCompletions: 1,
    collectCustomerDetails: true,
    customFields: {
      internal_reference: 'TPL-CONSULTING-FEE',
      campaign_code: 'SERVICES',
      sales_note: 'Use for bespoke consulting or advisory invoices.',
    },
  },
  {
    name: 'Donation',
    title: 'Support our community work',
    subtitle: 'Choose any amount that feels right',
    description: '## Thank you\n\nYour contribution helps fund future programs, scholarships, and open events.',
    pricingMode: 'custom_amount',
    customAmountMin: 5,
    customAmountMax: 500,
    customAmountCurrencyCode: 'USD',
    maxCompletions: null,
    collectCustomerDetails: false,
    customFields: {
      internal_reference: 'TPL-DONATION',
      campaign_code: 'FUNDRAISING',
      sales_note: 'Simple pay-link example without mandatory customer details.',
    },
  },
  {
    name: 'Event Ticket',
    title: 'Spring Gala ticket',
    subtitle: 'Select the right ticket tier',
    description: '## Ticket tiers\n\nChoose between General, VIP, and Premium access for the gala event.',
    pricingMode: 'price_list',
    priceListItems: [
      { id: 'general', description: 'General admission', amount: 25, currencyCode: 'USD' },
      { id: 'vip', description: 'VIP ticket', amount: 75, currencyCode: 'USD' },
      { id: 'premium', description: 'Premium table seat', amount: 150, currencyCode: 'USD' },
    ],
    maxCompletions: 100,
    collectCustomerDetails: true,
    customFields: {
      internal_reference: 'TPL-SPRING-GALA',
      campaign_code: 'EVENTS',
      sales_note: 'Event ticketing example with a compact price list.',
    },
  },
]

const LINK_SEEDS: LinkSeed[] = [
  {
    templateName: 'Consulting Fee',
    name: 'January Consulting Session',
    title: 'January consulting session',
    subtitle: 'Invoice for a one-hour advisory meeting',
    description: '## January consulting session\n\nThis pay link covers the agreed one-hour consulting engagement.',
    slug: 'january-consulting',
    customFields: {
      internal_reference: 'LINK-JAN-CONSULTING',
      campaign_code: 'JAN-2026',
      sales_note: 'Seeded sample link for one-off consulting work.',
    },
  },
  {
    templateName: 'Donation',
    name: 'Community Donation',
    title: 'Community donation',
    subtitle: 'Support the initiative with a custom amount',
    description: '## Support the mission\n\nA simple pay link for collecting donations without a long customer form.',
    slug: 'donate',
    customFields: {
      internal_reference: 'LINK-DONATE',
      campaign_code: 'COMMUNITY',
      sales_note: 'Seeded simple pay-link example.',
    },
  },
  {
    templateName: 'Event Ticket',
    name: 'Spring Gala 2026',
    title: 'Spring Gala 2026',
    subtitle: 'Choose a ticket tier and reserve your seat',
    description: '## Spring Gala 2026\n\nPick your ticket tier and complete the payment to confirm attendance.',
    slug: 'spring-gala-2026',
    customFields: {
      internal_reference: 'LINK-SPRING-GALA-2026',
      campaign_code: 'GALA-2026',
      sales_note: 'Seeded event ticket pay link.',
    },
  },
]

function cloneCustomerFields() {
  return DEFAULT_CHECKOUT_CUSTOMER_FIELDS.map((field) => ({ ...field }))
}

async function ensureTemplate(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  seed: TemplateSeed,
): Promise<{ template: CheckoutLinkTemplate; created: boolean }> {
  const existing = await em.findOne(CheckoutLinkTemplate, {
    name: seed.name,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (existing) {
    return { template: existing, created: false }
  }

  const template = em.create(CheckoutLinkTemplate, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    name: seed.name,
    title: seed.title,
    subtitle: seed.subtitle,
    description: seed.description,
    themeMode: 'auto',
    pricingMode: seed.pricingMode,
    fixedPriceAmount: toMoneyString(seed.fixedPriceAmount ?? null),
    fixedPriceCurrencyCode: seed.fixedPriceCurrencyCode ?? null,
    fixedPriceIncludesTax: true,
    fixedPriceOriginalAmount: null,
    customAmountMin: toMoneyString(seed.customAmountMin ?? null),
    customAmountMax: toMoneyString(seed.customAmountMax ?? null),
    customAmountCurrencyCode: seed.customAmountCurrencyCode ?? null,
    priceListItems: seed.priceListItems?.map((item) => ({ ...item })) ?? null,
    gatewayProviderKey: null,
    gatewaySettings: {},
    collectCustomerDetails: seed.collectCustomerDetails ?? true,
    customerFieldsSchema: cloneCustomerFields(),
    legalDocuments: {},
    displayCustomFieldsOnPage: false,
    sendStartEmail: true,
    sendSuccessEmail: true,
    sendErrorEmail: true,
    maxCompletions: seed.maxCompletions ?? null,
    status: 'draft',
    checkoutType: 'pay_link',
  })
  em.persist(template)
  return { template, created: true }
}

async function ensureLink(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  template: CheckoutLinkTemplate,
  seed: LinkSeed,
): Promise<{ link: CheckoutLink; created: boolean }> {
  const existing = await em.findOne(CheckoutLink, {
    slug: seed.slug,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (existing) {
    return { link: existing, created: false }
  }

  const values = toTemplateOrLinkMutationInput(template, {
    name: seed.name,
    title: seed.title,
    subtitle: seed.subtitle,
    description: seed.description,
    slug: seed.slug,
    templateId: template.id,
    status: 'draft',
  })

  const link = em.create(CheckoutLink, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    completionCount: 0,
    activeReservationCount: 0,
    isLocked: false,
    ...values,
    slug: seed.slug,
    fixedPriceAmount: toMoneyString(values.fixedPriceAmount ?? null),
    fixedPriceOriginalAmount: toMoneyString(values.fixedPriceOriginalAmount ?? null),
    customAmountMin: toMoneyString(values.customAmountMin ?? null),
    customAmountMax: toMoneyString(values.customAmountMax ?? null),
  })
  em.persist(link)
  return { link, created: true }
}

async function assignCustomFields(args: {
  dataEngine: DataEngine
  entityId: string
  recordId: string
  tenantId: string
  organizationId: string
  values?: Record<string, unknown>
}) {
  if (!args.values || Object.keys(args.values).length === 0) return
  try {
    await setCustomFieldsIfAny({
      dataEngine: args.dataEngine,
      entityId: args.entityId,
      recordId: args.recordId,
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      values: args.values,
    })
  } catch (error) {
    console.warn('[checkout.seed] Failed to set example custom field values', error)
  }
}

export async function seedCheckoutExamples({ em, container, tenantId, organizationId }: InitSetupContext) {
  const scope = { tenantId, organizationId }
  const dataEngine = container.resolve('dataEngine') as DataEngine
  const templateAssignments: Array<() => Promise<void>> = []
  const linkAssignments: Array<() => Promise<void>> = []
  const templatesByName = new Map<string, CheckoutLinkTemplate>()

  for (const seed of TEMPLATE_SEEDS) {
    const { template, created } = await ensureTemplate(em, scope, seed)
    templatesByName.set(seed.name, template)
    if (created) {
      templateAssignments.push(() => assignCustomFields({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.template,
        recordId: template.id,
        tenantId,
        organizationId,
        values: seed.customFields,
      }))
    }
  }

  await em.flush()

  for (const assign of templateAssignments) {
    await assign()
  }

  for (const seed of LINK_SEEDS) {
    const template = templatesByName.get(seed.templateName)
    if (!template) continue
    const { link, created } = await ensureLink(em, scope, template, seed)
    if (created) {
      linkAssignments.push(() => assignCustomFields({
        dataEngine,
        entityId: CHECKOUT_ENTITY_IDS.link,
        recordId: link.id,
        tenantId,
        organizationId,
        values: seed.customFields,
      }))
    }
  }

  await em.flush()

  for (const assign of linkAssignments) {
    await assign()
  }
}
