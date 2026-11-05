import type { EntityExtension } from '@open-mercato/shared/modules/entities'

export const extensions: EntityExtension[] = [
  {
    base: 'customers:customer_entity',
    extension: 'documents:document_entity_link',
    join: { baseKey: 'id', extensionKey: 'customer_entity_id' },
    cardinality: 'one-to-many',
  },
  {
    base: 'customers:customer_deal',
    extension: 'documents:document_entity_link',
    join: { baseKey: 'id', extensionKey: 'deal_id' },
    cardinality: 'one-to-many',
  },
  {
    base: 'catalog:catalog_product',
    extension: 'documents:document_entity_link',
    join: { baseKey: 'id', extensionKey: 'product_id' },
    cardinality: 'one-to-many',
  },
  {
    base: 'catalog:catalog_offer',
    extension: 'documents:document_entity_link',
    join: { baseKey: 'id', extensionKey: 'catalog_offer_id' },
    cardinality: 'one-to-many',
  },
  {
    base: 'sales:sales_quote',
    extension: 'documents:document_entity_link',
    join: { baseKey: 'id', extensionKey: 'quote_id' },
    cardinality: 'one-to-many',
  },
  {
    base: 'sales:sales_order',
    extension: 'documents:document_entity_link',
    join: { baseKey: 'id', extensionKey: 'sales_order_id' },
    cardinality: 'one-to-many',
  },
]

export default extensions
