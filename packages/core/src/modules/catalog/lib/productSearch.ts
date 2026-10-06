import { buildAccentInsensitiveSearchExpression } from '@open-mercato/shared/lib/db/accentInsensitiveSearch'

/**
 * Columns `GET /api/catalog/products?search=` matches against, in the order the
 * GIN trigram index concatenates them. The list is shared with
 * `migrations/Migration20260914120100` so the query predicate and the index
 * expression cannot drift apart — when they do, PostgreSQL stops using the index
 * without any error, it just gets slower.
 *
 * Property names and column names are identical for all five (single words, no
 * camelCase), so this list doubles as the field list the encrypted-`ILIKE`
 * diagnostic needs.
 */
export const PRODUCT_SEARCH_COLUMNS = ['title', 'subtitle', 'description', 'sku', 'handle'] as const

export const PRODUCT_SEARCH_EXPRESSION_SQL = buildAccentInsensitiveSearchExpression(PRODUCT_SEARCH_COLUMNS)
