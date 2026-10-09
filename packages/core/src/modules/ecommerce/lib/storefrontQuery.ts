import type { z } from 'zod'
import {
  ecommerceStorefrontCategoryLandingQuerySchema,
  ecommerceStorefrontCategoryTreeQuerySchema,
  ecommerceStorefrontContextQuerySchema,
  ecommerceStorefrontProductDetailQuerySchema,
  ecommerceStorefrontProductListQuerySchema,
  ecommerceStorefrontSearchSuggestQuerySchema,
  type EcommerceStorefrontCategoryLandingQuery,
  type EcommerceStorefrontCategoryTreeQuery,
  type EcommerceStorefrontContextQuery,
  type EcommerceStorefrontProductDetailQuery,
  type EcommerceStorefrontProductListQuery,
  type EcommerceStorefrontSearchSuggestQuery,
} from '../data/validators'

export type StorefrontQueryErrorCode = 'unknown_parameter' | 'duplicate_parameter' | 'invalid_parameter'

export type StorefrontQueryIssue = {
  parameter: string
  message: string
}

/**
 * A rejected storefront query string (Storefront Public API §4.1, R6). Unknown, repeated and
 * malformed parameters are a `400`, never silently ignored: an ignored misspelled filter shows the
 * buyer an unfiltered catalogue that looks filtered.
 */
export class StorefrontQueryError extends Error {
  readonly status = 400 as const
  readonly code: StorefrontQueryErrorCode
  readonly issues: StorefrontQueryIssue[]

  constructor(code: StorefrontQueryErrorCode, issues: StorefrontQueryIssue[]) {
    super(`[internal] storefront query rejected: ${code} (${issues.map((issue) => issue.parameter).join(', ')})`)
    this.name = 'StorefrontQueryError'
    this.code = code
    this.issues = issues
  }
}

export function isStorefrontQueryError(error: unknown): error is StorefrontQueryError {
  return error instanceof StorefrontQueryError
}

export type StorefrontQueryInput = URLSearchParams | Iterable<readonly [string, string]> | Record<string, string>

const OPTION_PARAMETER = /^options\[([^\][]*)\]$/

function toEntries(input: StorefrontQueryInput): Array<readonly [string, string]> {
  if (input instanceof URLSearchParams) return Array.from(input.entries())
  if (Symbol.iterator in Object(input)) return Array.from(input as Iterable<readonly [string, string]>)
  return Object.entries(input as Record<string, string>)
}

function splitValues(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  )
}

function zodIssues(error: z.ZodError): { code: StorefrontQueryErrorCode; issues: StorefrontQueryIssue[] } {
  const unknown: StorefrontQueryIssue[] = []
  const invalid: StorefrontQueryIssue[] = []
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) unknown.push({ parameter: key, message: 'unknown parameter' })
      continue
    }
    const [head, ...rest] = issue.path.map(String)
    const parameter = head === 'options' && rest.length ? `options[${rest[0]}]` : head ?? 'query'
    invalid.push({ parameter, message: issue.message })
  }
  if (unknown.length) return { code: 'unknown_parameter', issues: unknown }
  return { code: 'invalid_parameter', issues: invalid }
}

/**
 * Parses the `GET /products` query grammar (Storefront Public API §4.1): bracket notation for
 * `options[code]=a,b`, comma lists for `tagSlugs`, `pageSize` capped at 100, strict keys. The
 * store-resolution parameters (`path`, `storeSlug`, `locale`) pass through so the route can parse
 * one query string once. Throws `StorefrontQueryError` (status 400) on any rejection.
 */
export function parseStorefrontProductListQuery(input: StorefrontQueryInput): EcommerceStorefrontProductListQuery {
  return parseStorefrontListGrammar(input, ecommerceStorefrontProductListQuerySchema)
}

/**
 * Parses the `GET /categories/:slug` query (Storefront Public API §4.4): the `GET /products` grammar
 * for the embedded listing, minus `categoryId` / `categorySlug` — the path slug is the category, so
 * either parameter is an unknown one and a `400`.
 */
export function parseStorefrontCategoryLandingQuery(input: StorefrontQueryInput): EcommerceStorefrontCategoryLandingQuery {
  return parseStorefrontListGrammar(input, ecommerceStorefrontCategoryLandingQuerySchema)
}

function parseStorefrontListGrammar<T>(input: StorefrontQueryInput, schema: z.ZodType<T, unknown>): T {
  const scalars: Record<string, string> = {}
  const options: Record<string, string[]> = {}
  const duplicates = new Set<string>()
  const malformed: StorefrontQueryIssue[] = []
  for (const [key, value] of toEntries(input)) {
    const optionMatch = OPTION_PARAMETER.exec(key)
    if (optionMatch) {
      const code = optionMatch[1].trim()
      if (!code.length) {
        malformed.push({ parameter: key, message: 'option code is required' })
        continue
      }
      if (code in options) {
        duplicates.add(key)
        continue
      }
      const values = splitValues(value)
      if (!values.length) {
        malformed.push({ parameter: key, message: 'option values are required' })
        continue
      }
      options[code] = values
      continue
    }
    if (key.startsWith('options')) {
      malformed.push({ parameter: key, message: 'options use bracket notation: options[code]=a,b' })
      continue
    }
    if (Object.prototype.hasOwnProperty.call(scalars, key)) {
      duplicates.add(key)
      continue
    }
    scalars[key] = value
  }
  if (duplicates.size) {
    throw new StorefrontQueryError(
      'duplicate_parameter',
      Array.from(duplicates).map((parameter) => ({ parameter, message: 'parameter given more than once' })),
    )
  }
  if (malformed.length) throw new StorefrontQueryError('invalid_parameter', malformed)
  const parsed = schema.safeParse({
    ...scalars,
    ...(Object.keys(options).length ? { options } : {}),
  })
  if (!parsed.success) {
    const { code, issues } = zodIssues(parsed.error)
    throw new StorefrontQueryError(code, issues)
  }
  return parsed.data
}

/**
 * Parses the `GET /products/:idOrHandle` query (Storefront Public API §4.2): `variantId`, `locale`
 * and the store-resolution parameters, with the same strictness as the listing — unknown, repeated
 * and malformed parameters throw `StorefrontQueryError` (status 400).
 */
export function parseStorefrontProductDetailQuery(input: StorefrontQueryInput): EcommerceStorefrontProductDetailQuery {
  return parseStorefrontScalarQuery(input, ecommerceStorefrontProductDetailQuerySchema)
}

/**
 * Parses the `GET /categories` query (Storefront Public API §4.3): `parentId`, `depth`,
 * `includeEmpty`, `locale` and the store-resolution parameters, strict like the other routes.
 */
export function parseStorefrontCategoryTreeQuery(input: StorefrontQueryInput): EcommerceStorefrontCategoryTreeQuery {
  return parseStorefrontScalarQuery(input, ecommerceStorefrontCategoryTreeQuerySchema)
}

/**
 * Parses the `GET /search/suggest` query (Storefront Public API §4.5): `q` (required, at most 200
 * characters — a shorter-than-minimum `q` is answered with empty results, not rejected), `limit`
 * (default 8, max 20), `locale` and the store-resolution parameters, strict like the other routes.
 */
export function parseStorefrontSearchSuggestQuery(input: StorefrontQueryInput): EcommerceStorefrontSearchSuggestQuery {
  return parseStorefrontScalarQuery(input, ecommerceStorefrontSearchSuggestQuerySchema)
}

/**
 * Parses the `GET /context` query: the store-resolution parameters (`storeSlug`, `locale`, `path`)
 * only, strict like the other routes.
 */
export function parseStorefrontContextQuery(input: StorefrontQueryInput): EcommerceStorefrontContextQuery {
  return parseStorefrontScalarQuery(input, ecommerceStorefrontContextQuerySchema)
}

function parseStorefrontScalarQuery<T>(input: StorefrontQueryInput, schema: z.ZodType<T, unknown>): T {
  const scalars: Record<string, string> = {}
  const duplicates = new Set<string>()
  for (const [key, value] of toEntries(input)) {
    if (Object.prototype.hasOwnProperty.call(scalars, key)) {
      duplicates.add(key)
      continue
    }
    scalars[key] = value
  }
  if (duplicates.size) {
    throw new StorefrontQueryError(
      'duplicate_parameter',
      Array.from(duplicates).map((parameter) => ({ parameter, message: 'parameter given more than once' })),
    )
  }
  const parsed = schema.safeParse(scalars)
  if (!parsed.success) {
    const { code, issues } = zodIssues(parsed.error)
    throw new StorefrontQueryError(code, issues)
  }
  return parsed.data
}
