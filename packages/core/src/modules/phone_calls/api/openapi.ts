import { type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const defaultOkResponseSchema = sharedDefaultOkResponseSchema

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildPhoneCallsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'PhoneCalls',
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
})

export function createPhoneCallsCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildPhoneCallsCrudOpenApi(options)
}
