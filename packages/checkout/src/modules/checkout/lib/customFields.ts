import type { EntityManager } from '@mikro-orm/postgresql'
import type { CustomFieldDisplayEntry } from '@open-mercato/shared/lib/crud/custom-fields'
import {
  decorateRecordWithCustomFields,
  loadCustomFieldDefinitionIndex,
} from '@open-mercato/shared/lib/crud/custom-fields'
import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import { loadEntityFieldsetConfigs } from '@open-mercato/core/modules/entities/lib/fieldsets'

type CheckoutFieldsetGroup = {
  code: string
  title?: string
  hint?: string
}

export type CheckoutFieldsetDefinition = {
  code: string
  label: string
  icon?: string
  description?: string
  groups?: CheckoutFieldsetGroup[]
}

export const CHECKOUT_LINK_FIELDSETS: CheckoutFieldsetDefinition[] = [
  {
    code: 'service_package',
    label: 'Service package',
    icon: 'briefcase',
    description: 'Customer-facing details for consulting, services, and appointment-style links.',
    groups: [
      { code: 'summary', title: 'What is included' },
      { code: 'details', title: 'Before you pay' },
    ],
  },
  {
    code: 'donation_campaign',
    label: 'Donation campaign',
    icon: 'heart',
    description: 'Public details that explain the donation purpose and follow-up process.',
    groups: [
      { code: 'summary', title: 'Impact summary' },
      { code: 'details', title: 'Support details' },
    ],
  },
  {
    code: 'event_ticket',
    label: 'Event ticket',
    icon: 'ticket',
    description: 'Event-specific information shown to attendees before they complete payment.',
    groups: [
      { code: 'summary', title: 'Event details' },
      { code: 'details', title: 'Ticket details' },
    ],
  },
]

export const CHECKOUT_LINK_CUSTOM_FIELDS: CustomFieldDefinition[] = [
  {
    key: 'service_deliverables',
    kind: 'multiline',
    label: 'What is included',
    description: 'Short bullet list or summary of what the customer receives after payment.',
    fieldset: 'service_package',
    group: { code: 'summary', title: 'What is included' },
    formEditable: true,
    listVisible: false,
  },
  {
    key: 'delivery_timeline',
    kind: 'text',
    label: 'Delivery timeline',
    description: 'When the customer should expect the next step, call, or deliverable.',
    fieldset: 'service_package',
    group: { code: 'details', title: 'Before you pay' },
    formEditable: true,
    listVisible: false,
    filterable: true,
  },
  {
    key: 'session_format',
    kind: 'text',
    label: 'Session format',
    description: 'Customer-facing note describing how the service is delivered.',
    fieldset: 'service_package',
    group: { code: 'details', title: 'Before you pay' },
    formEditable: true,
    listVisible: false,
  },
  {
    key: 'impact_summary',
    kind: 'multiline',
    label: 'Impact summary',
    description: 'Public explanation of what the donation supports.',
    fieldset: 'donation_campaign',
    group: { code: 'summary', title: 'Impact summary' },
    formEditable: true,
    listVisible: false,
  },
  {
    key: 'donation_usage',
    kind: 'text',
    label: 'How the donation is used',
    description: 'One-line explanation of how funds are allocated.',
    fieldset: 'donation_campaign',
    group: { code: 'details', title: 'Support details' },
    formEditable: true,
    listVisible: false,
  },
  {
    key: 'tax_receipt_note',
    kind: 'text',
    label: 'Tax receipt note',
    description: 'Public note about receipts or donation confirmation after payment.',
    fieldset: 'donation_campaign',
    group: { code: 'details', title: 'Support details' },
    formEditable: true,
    listVisible: false,
  },
  {
    key: 'event_date',
    kind: 'text',
    label: 'Event date',
    description: 'Date and start time shown before the ticket is purchased.',
    fieldset: 'event_ticket',
    group: { code: 'summary', title: 'Event details' },
    formEditable: true,
    listVisible: false,
    filterable: true,
  },
  {
    key: 'event_location',
    kind: 'text',
    label: 'Event location',
    description: 'Venue or access point shown on the pay page.',
    fieldset: 'event_ticket',
    group: { code: 'summary', title: 'Event details' },
    formEditable: true,
    listVisible: false,
    filterable: true,
  },
  {
    key: 'ticket_includes',
    kind: 'multiline',
    label: 'Ticket includes',
    description: 'What is included with the ticket purchase.',
    fieldset: 'event_ticket',
    group: { code: 'details', title: 'Ticket details' },
    formEditable: true,
    listVisible: false,
  },
  {
    key: 'support_contact',
    kind: 'text',
    label: 'Support contact',
    description: 'Public contact detail for customer questions about this pay link.',
    fieldsets: ['service_package', 'donation_campaign', 'event_ticket'],
    group: { code: 'details', title: 'Support details' },
    formEditable: true,
    listVisible: false,
    filterable: true,
  },
]

function normalizeFieldsetCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function resolveCheckoutPublicCustomFields(args: {
  em: EntityManager
  entityId: string
  tenantId: string
  organizationId: string
  customFieldsetCode?: string | null
  customValues?: Record<string, unknown> | null
  displayCustomFieldsOnPage?: boolean | null
}): Promise<CustomFieldDisplayEntry[]> {
  if (args.displayCustomFieldsOnPage !== true) return []
  if (!args.customValues || Object.keys(args.customValues).length === 0) return []

  const selectedFieldset = normalizeFieldsetCode(args.customFieldsetCode)
  const fieldsetConfigs = await loadEntityFieldsetConfigs(args.em, {
    entityIds: [args.entityId],
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    mode: 'public',
  })
  const availableFieldsets = fieldsetConfigs.get(args.entityId)?.fieldsets ?? []
  if (availableFieldsets.length > 0) {
    if (!selectedFieldset) return []
    if (!availableFieldsets.some((fieldset) => fieldset.code === selectedFieldset)) return []
  }

  const definitions = await loadCustomFieldDefinitionIndex({
    em: args.em,
    entityIds: args.entityId,
    tenantId: args.tenantId,
    organizationIds: [args.organizationId],
    fieldset: selectedFieldset,
  })
  if (!definitions.size) return []

  const filteredValues = Object.fromEntries(
    Object.entries(args.customValues).filter(([key]) => definitions.has(key.trim().toLowerCase())),
  )
  if (!Object.keys(filteredValues).length) return []

  return decorateRecordWithCustomFields(
    { customFields: filteredValues },
    definitions,
    {
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    },
  ).customFields
}
