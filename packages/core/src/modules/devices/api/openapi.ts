import { type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

// createCrudOpenApiFactory already falls back to the shared default create/ok response schemas
// when omitted, so there is nothing module-specific to re-pass or re-export here.
const buildDevicesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Devices',
  makeListDescription: ({ pluralLower }) =>
    `Returns the authenticated user's registered ${pluralLower} (admins may list across users).`,
})

export function createDevicesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildDevicesCrudOpenApi(options)
}
