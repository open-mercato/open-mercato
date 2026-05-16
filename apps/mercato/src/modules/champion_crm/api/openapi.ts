import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const championCrmTag = 'Champion CRM'

export const championCrmErrorSchema = z.object({ error: z.string() }).passthrough()
export const championCrmOkSchema = z.object({ ok: z.literal(true) })
export const championCrmCreatedSchema = z.object({ id: z.string().uuid() })

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildChampionCrmCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: championCrmTag,
  defaultCreateResponseSchema: championCrmCreatedSchema,
  defaultOkResponseSchema: championCrmOkSchema,
})

export function createChampionCrmCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildChampionCrmCrudOpenApi(options)
}

