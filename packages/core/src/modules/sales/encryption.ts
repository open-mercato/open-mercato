import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'sales:sales_order',
    fields: [
      { field: 'customer_snapshot' },
      { field: 'billing_address_snapshot' },
      { field: 'shipping_address_snapshot' },
      { field: 'shipping_method_snapshot' },
      { field: 'delivery_window_snapshot' },
      { field: 'payment_method_snapshot' },
      { field: 'totals_snapshot' },
      { field: 'catalog_snapshot' },
      { field: 'promotion_snapshot' },
      { field: 'comments' },
      { field: 'internal_notes' },
      { field: 'metadata' },
    ],
  },
  {
    entityId: 'sales:sales_quote',
    fields: [
      { field: 'customer_snapshot' },
      { field: 'billing_address_snapshot' },
      { field: 'shipping_address_snapshot' },
      { field: 'shipping_method_snapshot' },
      { field: 'delivery_window_snapshot' },
      { field: 'payment_method_snapshot' },
      { field: 'totals_snapshot' },
      { field: 'catalog_snapshot' },
      { field: 'promotion_snapshot' },
      { field: 'comments' },
      { field: 'internal_notes' },
      { field: 'metadata' },
    ],
  },
  {
    entityId: 'sales:sales_document_address',
    fields: [
      { field: 'name' },
      { field: 'purpose' },
      { field: 'company_name' },
      { field: 'address_line1' },
      { field: 'address_line2' },
      { field: 'city' },
      { field: 'region' },
      { field: 'postal_code' },
      { field: 'country' },
      { field: 'building_number' },
      { field: 'flat_number' },
    ],
  },
  {
    entityId: 'sales:sales_note',
    fields: [{ field: 'body' }],
  },
]

export default defaultEncryptionMaps
