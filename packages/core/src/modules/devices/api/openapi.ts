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
// The shared zodToJsonSchema converter does not emit per-property descriptions for object schemas, so
// the `.describe()` markers on the deprecated keys in deviceList.ts never reach the document. State the
// deprecation in the endpoint description, which does render (#5513).
export const DEPRECATED_SNAKE_CASE_NOTICE =
  'Response keys are camelCase. The snake_case keys (`user_id`, `device_id`, `last_seen_at`, …) are ' +
  'deprecated aliases of their camelCase counterparts, retained for one minor version and removed in ' +
  'the next; read `userId`, `deviceId`, `lastSeenAt`, … instead.'

const buildDevicesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Devices',
  makeListDescription: ({ pluralLower }) =>
    `Returns the authenticated user's registered ${pluralLower} (admins may list across users). ${DEPRECATED_SNAKE_CASE_NOTICE}`,
})

export function createDevicesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildDevicesCrudOpenApi(options)
}
