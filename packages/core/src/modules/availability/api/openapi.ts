import { z, type ZodTypeAny } from 'zod'
import type { OpenApiResponseDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema as sharedDefaultCreateResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const defaultCreateResponseSchema = sharedDefaultCreateResponseSchema
export const defaultOkResponseSchema = sharedDefaultOkResponseSchema
export const organizationSelectionInvalidError: OpenApiResponseDoc = {
  status: 422,
  description: 'Selected organization is no longer available',
  schema: z.object({ error: z.string(), code: z.literal('organization_selection_invalid') }),
}

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildAvailabilityCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Availability',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
})

export function createAvailabilityCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildAvailabilityCrudOpenApi(options)
}
