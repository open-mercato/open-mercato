import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema as sharedDefaultCreateResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const defaultCreateResponseSchema = sharedDefaultCreateResponseSchema
export const defaultOkResponseSchema = z.object({ ok: z.boolean() })
export const defaultDeleteRequestSchema = z.object({ id: z.string().uuid() })

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema)
}

const buildSalesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Sales',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} that belong to the current organization.`,
  makeUpdateRequestBodyDescription: ({ resourceLower }) =>
    `Fields to update on the target ${resourceLower}.`,
})

export function createSalesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildSalesCrudOpenApi(options)
}
