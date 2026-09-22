import { type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema as sharedDefaultCreateResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const defaultCreateResponseSchema = sharedDefaultCreateResponseSchema
export const defaultOkResponseSchema = sharedDefaultOkResponseSchema

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildLedgerCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Ledger',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
})

// Mirrors currencies/api/openapi.ts's per-module wrapper (see OM-11) —
// `resourceName`/`querySchema`/`create`/`update`/`del` are supplied per
// route; `journal-entries` (read-only) simply omits `create`/`update`/`del`.
export function createLedgerCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildLedgerCrudOpenApi(options)
}
