/**
 * Equality filters for `GET /api/production/orders` — `makeCrudRoute`'s
 * default `buildFilters` is `{}` (only the advanced-filter tree query
 * syntax is merged automatically), so plain `?productId=`/`?sourceType=`/
 * `?sourceId=` query params need an explicit mapping to actually narrow the
 * result set. Kept in its own module (rather than inline in `route.ts`) so
 * it is cheaply unit-testable without pulling in `makeCrudRoute`/generated
 * entity ids.
 *
 * `sourceType`/`sourceId` is the exact lookup shape the sales order-detail
 * "Production" tab widget uses to list production orders linked to a given
 * sales order (spec § Sales integration).
 */
export function buildOrderListFilters(query: Record<string, unknown>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.productId) filters.productId = { $eq: query.productId }
  if (query.variantId) filters.variantId = { $eq: query.variantId }
  if (query.status) {
    // `?status=` accepts a single value (kept as `$eq` for backward
    // compatibility) or a comma-separated list (the orders list UI's
    // multi-select status filter, task 3.4).
    const values = String(query.status)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    filters.status = values.length > 1 ? { $in: values } : { $eq: values[0] }
  }
  if (query.sourceType) filters.sourceType = { $eq: query.sourceType }
  if (query.sourceId) filters.sourceId = { $eq: query.sourceId }
  return filters
}
