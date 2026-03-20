import type {
  CustomEntitySpec,
  CustomFieldDefinition,
} from '@open-mercato/shared/modules/entities'
import { CHECKOUT_ENTITY_IDS } from './lib/constants'
import { CHECKOUT_LINK_CUSTOM_FIELDS } from './lib/customFields'

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
    fields: CHECKOUT_LINK_CUSTOM_FIELDS,
  },
  {
    id: CHECKOUT_ENTITY_IDS.template,
    label: 'Link Template',
    description: 'Custom fields for checkout link templates',
    labelField: 'name',
    showInSidebar: false,
    fields: CHECKOUT_LINK_CUSTOM_FIELDS,
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
