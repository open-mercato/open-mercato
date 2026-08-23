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

// Read-only delivery log: only the list operation is documented, so the factory's shared
// create/ok response-schema fallbacks are left untouched (no need to pass or re-export them).
const buildPushNotificationsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'PushNotifications',
  makeListDescription: ({ pluralLower }) => `Returns the tenant's push ${pluralLower} (admin observability).`,
})

export function createPushNotificationsCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildPushNotificationsCrudOpenApi(options)
}
