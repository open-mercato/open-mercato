import type { CustomEntitySpec, CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import { CHECKOUT_ENTITY_IDS } from './lib/constants'

const checkoutLinkFields = [
  {
    key: 'internal_reference',
    kind: 'text',
    label: 'Internal reference',
    description: 'Private reference visible only in the admin.',
    filterable: true,
    formEditable: true,
    indexed: true,
  },
  {
    key: 'campaign_code',
    kind: 'text',
    label: 'Campaign code',
    description: 'Optional code used to group pay links by campaign or source.',
    filterable: true,
    formEditable: true,
  },
  {
    key: 'sales_note',
    kind: 'multiline',
    label: 'Sales note',
    description: 'Internal context for the team handling this pay link.',
    editor: 'markdown',
    formEditable: true,
  },
] satisfies CustomFieldDefinition[]

const checkoutTransactionFields = [
  {
    key: 'settlement_batch',
    kind: 'text',
    label: 'Settlement batch',
    description: 'Batch or payout reference from finance operations.',
    filterable: true,
    formEditable: true,
    indexed: true,
  },
  {
    key: 'reconciliation_note',
    kind: 'multiline',
    label: 'Reconciliation note',
    description: 'Internal finance note attached to the transaction.',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'receipt_attachment',
    kind: 'attachment',
    label: 'Receipt attachment',
    description: 'Optional external receipt or proof of payment.',
    formEditable: true,
    acceptExtensions: ['pdf', 'png', 'jpg', 'jpeg'],
    maxAttachmentSizeMb: 10,
  },
] satisfies CustomFieldDefinition[]

export const entities: CustomEntitySpec[] = [
  {
    id: CHECKOUT_ENTITY_IDS.link,
    label: 'Pay Link',
    description: 'Custom fields for pay links',
    labelField: 'name',
    showInSidebar: false,
    fields: checkoutLinkFields,
  },
  {
    id: CHECKOUT_ENTITY_IDS.template,
    label: 'Link Template',
    description: 'Custom fields for checkout link templates',
    labelField: 'name',
    showInSidebar: false,
    fields: checkoutLinkFields,
  },
  {
    id: CHECKOUT_ENTITY_IDS.transaction,
    label: 'Checkout Transaction',
    description: 'Custom fields for checkout transactions',
    labelField: 'id',
    showInSidebar: false,
    fields: checkoutTransactionFields,
  },
]

export default entities
