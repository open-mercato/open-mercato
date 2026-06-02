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

const buildDevicesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Devices',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns the authenticated user's registered ${pluralLower} (admins may list across users).`,
})

export function createDevicesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildDevicesCrudOpenApi(options)
}
