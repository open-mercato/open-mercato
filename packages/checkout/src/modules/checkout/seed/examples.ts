import type { EntityManager } from '@mikro-orm/postgresql'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { CheckoutLink, CheckoutLinkTemplate } from '../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../lib/defaults'
import { ensureUniqueSlug, toMoneyString, toTemplateOrLinkMutationInput } from '../lib/utils'
import { ensureCheckoutFieldsetsAndDefinitions } from './customFields'

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
  customFieldsetCode?: string | null
  displayCustomFieldsOnPage?: boolean
  successTitle?: string
  successMessage?: string
  cancelTitle?: string
  cancelMessage?: string
  errorTitle?: string
  errorMessage?: string
  startEmailSubject?: string
  startEmailBody?: string
  successEmailSubject?: string
  successEmailBody?: string
  errorEmailSubject?: string
  errorEmailBody?: string
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
    customFieldsetCode: 'service_package',
    displayCustomFieldsOnPage: true,
    successTitle: 'Booking confirmed',
    successMessage: '## Payment received\n\nThank you for booking your consulting session. We will send the meeting invite and prep notes within one business day.',
    cancelTitle: 'Payment cancelled',
    cancelMessage: 'No worries. Your consulting slot has not been confirmed yet. You can return to this link when you are ready.',
    errorTitle: 'Payment needs another try',
    errorMessage: 'We could not finish the payment for your consulting session. Please retry or contact us if the issue continues.',
    startEmailSubject: 'We received your consulting payment request',
    startEmailBody: 'Hi {{firstName}},\n\nWe started processing your payment for **{{linkTitle}}** in the amount of **{{amount}} {{currencyCode}}**.',
    successEmailSubject: 'Your consulting session is confirmed',
    successEmailBody: 'Hi {{firstName}},\n\nYour payment for **{{linkTitle}}** was completed successfully.\n\nTransaction reference: `{{transactionId}}`.\n\nWe will follow up with scheduling details shortly.',
    errorEmailSubject: 'We could not complete your payment',
    errorEmailBody: 'Hi {{firstName}},\n\nYour payment for **{{linkTitle}}** could not be completed. {{errorMessage}}\n\nYou can retry using the same link.',
    collectCustomerDetails: true,
    customFields: {
      service_deliverables: '- 60 minute strategy call\n- Written summary with next steps\n- Follow-up recommendations by email',
      delivery_timeline: 'We send the meeting invite and prep notes within 1 business day after payment.',
      session_format: 'Remote video call',
      support_contact: 'ops@open-mercato.com',
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
    customFieldsetCode: 'donation_campaign',
    displayCustomFieldsOnPage: true,
    successTitle: 'Thank you for your support',
    successMessage: '## Donation received\n\nThank you for supporting our community work. Your contribution helps us fund new workshops, scholarships, and open events.',
    cancelTitle: 'Donation not completed',
    cancelMessage: 'Your donation was not completed. You can come back to this page any time and try again.',
    errorTitle: 'Donation payment failed',
    errorMessage: 'We could not complete the donation payment. Please retry in a moment or use another payment method if available.',
    startEmailSubject: 'Your donation payment is being processed',
    startEmailBody: 'Hi {{firstName}},\n\nWe started processing your donation for **{{linkTitle}}** in the amount of **{{amount}} {{currencyCode}}**.',
    successEmailSubject: 'Thank you for your donation',
    successEmailBody: 'Hi {{firstName}},\n\nYour donation for **{{linkTitle}}** was completed successfully.\n\nReference: `{{transactionId}}`.\n\nThank you for helping us continue this work.',
    errorEmailSubject: 'Your donation payment needs another try',
    errorEmailBody: 'Hi {{firstName}},\n\nWe could not complete your donation payment. {{errorMessage}}\n\nYou can use the same link to try again.',
    collectCustomerDetails: false,
    customFields: {
      impact_summary: 'Your donation helps fund free community workshops and scholarship places for new participants.',
      donation_usage: 'Funds support programming, venue costs, and materials.',
      tax_receipt_note: 'A donation confirmation email is sent after successful payment.',
      support_contact: 'donations@open-mercato.com',
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
    customFieldsetCode: 'event_ticket',
    displayCustomFieldsOnPage: true,
    successTitle: 'Your seat is reserved',
    successMessage: '## Ticket purchased\n\nThank you for purchasing your Spring Gala ticket. Please keep the confirmation email for check-in details.',
    cancelTitle: 'Ticket payment cancelled',
    cancelMessage: 'Your ticket was not reserved. You can return to this page to complete the purchase later.',
    errorTitle: 'Ticket payment failed',
    errorMessage: 'We could not complete the ticket payment. Please retry or contact the events team for assistance.',
    startEmailSubject: 'Your event ticket payment is being processed',
    startEmailBody: 'Hi {{firstName}},\n\nWe started processing your payment for **{{linkTitle}}** in the amount of **{{amount}} {{currencyCode}}**.',
    successEmailSubject: 'Your Spring Gala ticket is confirmed',
    successEmailBody: 'Hi {{firstName}},\n\nYour payment for **{{linkTitle}}** was successful.\n\nTicket reference: `{{transactionId}}`.\n\nWe look forward to seeing you at the event.',
    errorEmailSubject: 'We could not confirm your event ticket',
    errorEmailBody: 'Hi {{firstName}},\n\nWe could not complete your ticket payment. {{errorMessage}}\n\nPlease use the same link to try again.',
    collectCustomerDetails: true,
    customFields: {
      event_date: 'May 14, 2026 at 7:00 PM',
      event_location: 'Mercato Hall, 12 River Street, New York',
      ticket_includes: '- Entry to the gala\n- Welcome drink\n- Networking session',
      support_contact: 'events@open-mercato.com',
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
      service_deliverables: '- 60 minute planning call\n- Action summary tailored to the January brief\n- Follow-up notes by email',
      delivery_timeline: 'We send the calendar invite within 4 business hours after payment.',
      session_format: 'Remote video call',
      support_contact: 'ops@open-mercato.com',
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
      impact_summary: 'Your support keeps the community program accessible and free to attend.',
      donation_usage: 'Funds go directly to programming, speakers, and participant materials.',
      tax_receipt_note: 'A donation confirmation will be emailed right after payment.',
      support_contact: 'donations@open-mercato.com',
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
      event_date: 'May 14, 2026 at 7:00 PM',
      event_location: 'Mercato Hall, 12 River Street, New York',
      ticket_includes: '- Gala entry\n- Welcome drink\n- Access to the networking lounge',
      support_contact: 'events@open-mercato.com',
    },
  },
]

function cloneCustomerFields() {
  return DEFAULT_CHECKOUT_CUSTOMER_FIELDS.map((field) => ({ ...field }))
}

function buildScopedSeedSlug(seedSlug: string, tenantId: string) {
  const suffix = tenantId.split('-')[0] || tenantId.slice(0, 8)
  return `${seedSlug}-${suffix}`
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
    customFieldsetCode: seed.customFieldsetCode ?? null,
    collectCustomerDetails: seed.collectCustomerDetails ?? true,
    customerFieldsSchema: cloneCustomerFields(),
    legalDocuments: {},
    displayCustomFieldsOnPage: seed.displayCustomFieldsOnPage ?? false,
    successTitle: seed.successTitle ?? null,
    successMessage: seed.successMessage ?? null,
    cancelTitle: seed.cancelTitle ?? null,
    cancelMessage: seed.cancelMessage ?? null,
    errorTitle: seed.errorTitle ?? null,
    errorMessage: seed.errorMessage ?? null,
    startEmailSubject: seed.startEmailSubject ?? null,
    startEmailBody: seed.startEmailBody ?? null,
    successEmailSubject: seed.successEmailSubject ?? null,
    successEmailBody: seed.successEmailBody ?? null,
    errorEmailSubject: seed.errorEmailSubject ?? null,
    errorEmailBody: seed.errorEmailBody ?? null,
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
  const scopedSlug = buildScopedSeedSlug(seed.slug, scope.tenantId)

  const existingByScopedSlug = await em.findOne(CheckoutLink, {
    slug: scopedSlug,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (existingByScopedSlug) {
    return { link: existingByScopedSlug, created: false }
  }

  const existingByLegacySlug = await em.findOne(CheckoutLink, {
    slug: seed.slug,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (existingByLegacySlug) {
    return { link: existingByLegacySlug, created: false }
  }

  const existingByName = await em.findOne(CheckoutLink, {
    name: seed.name,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (existingByName) {
    return { link: existingByName, created: false }
  }

  const uniqueSlug = await ensureUniqueSlug(em, scope, scopedSlug, `${seed.name}-${scope.tenantId.slice(0, 8)}`)

  const values = toTemplateOrLinkMutationInput(template, {
    name: seed.name,
    title: seed.title,
    subtitle: seed.subtitle,
    description: seed.description,
    slug: uniqueSlug,
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
    slug: uniqueSlug,
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
  await ensureCheckoutFieldsetsAndDefinitions(em, scope)
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
