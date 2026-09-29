// `/api/catalog/prices` list/detail responses serialize snake_case column
// names (verified against the live route by
// `__integration__/TC-CAT-CRUDFORM-002.spec.ts`: `variant_id`,
// `unit_price_gross`, `min_quantity`, ...) — this normalizes either shape
// into one camelCase record so UI code never has to guess which one it got.

export type NormalizedPriceRecord = {
  id: string
  productId: string | null
  variantId: string | null
  priceKindId: string | null
  currencyCode: string | null
  kind: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  minQuantity: number
  maxQuantity: number | null
  startsAt: string | null
  endsAt: string | null
  customerId: string | null
  customerGroupId: string | null
  channelId: string | null
  offerId: string | null
  userId: string | null
  userGroupId: string | null
  updatedAt: string | null
}

function str(record: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
  const value = record[camelKey] ?? record[snakeKey]
  return typeof value === 'string' && value.length ? value : null
}

function num(record: Record<string, unknown>, camelKey: string, snakeKey: string, fallback: number): number {
  const value = record[camelKey] ?? record[snakeKey]
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function numOrNull(record: Record<string, unknown>, camelKey: string, snakeKey: string): number | null {
  const value = record[camelKey] ?? record[snakeKey]
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizePriceRecord(record: Record<string, unknown>): NormalizedPriceRecord {
  return {
    id: str(record, 'id', 'id') ?? '',
    productId: str(record, 'productId', 'product_id'),
    variantId: str(record, 'variantId', 'variant_id'),
    priceKindId: str(record, 'priceKindId', 'price_kind_id'),
    currencyCode: str(record, 'currencyCode', 'currency_code'),
    kind: str(record, 'kind', 'kind') ?? 'regular',
    unitPriceNet: str(record, 'unitPriceNet', 'unit_price_net'),
    unitPriceGross: str(record, 'unitPriceGross', 'unit_price_gross'),
    taxRate: str(record, 'taxRate', 'tax_rate'),
    minQuantity: num(record, 'minQuantity', 'min_quantity', 1),
    maxQuantity: numOrNull(record, 'maxQuantity', 'max_quantity'),
    startsAt: str(record, 'startsAt', 'starts_at'),
    endsAt: str(record, 'endsAt', 'ends_at'),
    customerId: str(record, 'customerId', 'customer_id'),
    customerGroupId: str(record, 'customerGroupId', 'customer_group_id'),
    channelId: str(record, 'channelId', 'channel_id'),
    offerId: str(record, 'offerId', 'offer_id'),
    userId: str(record, 'userId', 'user_id'),
    userGroupId: str(record, 'userGroupId', 'user_group_id'),
    updatedAt: str(record, 'updatedAt', 'updated_at'),
  }
}
