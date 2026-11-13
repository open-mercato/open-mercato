import { z } from 'zod'
import { buildQueryParams, type QueryParamValue } from '@open-mercato/shared/lib/crud/query-params'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { sanitizeSearchTerm } from '@open-mercato/shared/lib/query/sanitizeSearchTerm'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'

export const CATALOG_VARIANT_LABELS_ENDPOINT = '/api/wms/catalog-variant-labels'

export const CATALOG_VARIANT_LABEL_FIELDS = ['id', 'name', 'sku', 'is_active'] as const

const MAX_LABEL_IDS = 100
const uuidSchema = z.string().uuid()

export const catalogVariantLabelsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: uuidSchema.optional(),
  ids: z.union([z.string(), z.array(z.string())]).optional(),
  search: z.string().max(200).optional(),
})

export type CatalogVariantLabelQuery = {
  page: number
  pageSize: number
  ids: string[]
  search: string
}

export type CatalogVariantLabelItem = {
  id: string
  sku: string | null
  name: string | null
  is_active: boolean | null
}

function readIdTokens(id: string | undefined, ids: QueryParamValue | undefined): string[] {
  const tokens: string[] = []
  if (id) tokens.push(id)
  const lists = Array.isArray(ids) ? ids : ids ? [ids] : []
  for (const list of lists) tokens.push(...parseCommaSeparatedList(list))
  return [...new Set(tokens)]
}

export function parseCatalogVariantLabelsQuery(searchParams: URLSearchParams): CatalogVariantLabelQuery {
  const parsed = catalogVariantLabelsQuerySchema.parse(buildQueryParams(searchParams))
  const ids = readIdTokens(parsed.id, parsed.ids)
  if (ids.length > MAX_LABEL_IDS) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: 'Too many ids',
        path: ['ids'],
      },
    ])
  }
  for (const id of ids) uuidSchema.parse(id)
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    ids,
    search: sanitizeSearchTerm(parsed.search),
  }
}

export function buildCatalogVariantLabelFilters(query: Pick<CatalogVariantLabelQuery, 'ids' | 'search'>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.ids.length === 1) {
    filters.id = { $eq: query.ids[0] }
  } else if (query.ids.length > 1) {
    filters.id = { $in: query.ids }
  }
  if (query.search) {
    const like = `%${escapeLikePattern(query.search)}%`
    filters.$or = [
      { name: { $ilike: like } },
      { sku: { $ilike: like } },
      { barcode: { $ilike: like } },
    ]
  }
  return filters
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function toCatalogVariantLabelItem(row: Record<string, unknown>): CatalogVariantLabelItem | null {
  const id = readOptionalText(row.id)
  if (!id || !uuidSchema.safeParse(id).success) return null
  return {
    id,
    sku: readOptionalText(row.sku),
    name: readOptionalText(row.name),
    is_active: typeof row.is_active === 'boolean' ? row.is_active : null,
  }
}
