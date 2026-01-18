import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const exampleTag = 'Example'

export const exampleErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const exampleOkSchema = z.object({
  ok: z.literal(true),
})

export const exampleCreatedSchema = z.object({
  id: z.string().uuid(),
})

export const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
})

export const optionsResponseSchema = z.object({
  items: z.array(optionSchema),
})

export const exampleOrganizationResponseSchema = optionsResponseSchema

export const assigneeQuerySchema = z.object({
  q: z.string().optional(),
})

export const organizationQuerySchema = z.object({
  ids: z.string().optional(),
})

export const todoListItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    tenant_id: z.string().nullable().optional(),
    organization_id: z.string().nullable().optional(),
    is_done: z.boolean().optional(),
  })
  .passthrough()

export function createExamplePagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildExampleCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: exampleTag,
  defaultCreateResponseSchema: exampleCreatedSchema,
  defaultOkResponseSchema: exampleOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current tenant scope.`,
})

export function createExampleCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildExampleCrudOpenApi(options)
}
