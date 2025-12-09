import type { EntityMetadata } from '@mikro-orm/core'

const TABLE_TO_ENTITY_ID: Record<string, string> = {
  users: 'auth:user',
  customer_addresses: 'customers:customer_address',
  customer_comments: 'customers:customer_comment',
  sales_orders: 'sales:sales_order',
  sales_quotes: 'sales:sales_quote',
  sales_notes: 'sales:sales_note',
}

const CLASS_TO_ENTITY_ID: Record<string, string> = {
  User: 'auth:user',
  CustomerAddress: 'customers:customer_address',
  CustomerComment: 'customers:customer_comment',
  SalesOrder: 'sales:sales_order',
  SalesQuote: 'sales:sales_quote',
  SalesNote: 'sales:sales_note',
}

export function resolveEntityIdFromMetadata(meta: EntityMetadata<any> | undefined): string | null {
  if (!meta) return null
  const table = (meta as any).collection || (meta as any).tableName || ''
  if (table && TABLE_TO_ENTITY_ID[table]) return TABLE_TO_ENTITY_ID[table]
  const name = (meta as any).className || meta.name || ''
  if (name && CLASS_TO_ENTITY_ID[name]) return CLASS_TO_ENTITY_ID[name]
  return null
}
