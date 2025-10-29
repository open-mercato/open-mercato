import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

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
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
    totalPages: z.number(),
  })
}

type CrudOpenApiOptions = {
  tag?: string
  resourceName: string
  pluralName?: string
  description?: string
  querySchema?: ZodTypeAny
  listResponseSchema: ZodTypeAny
  create?: {
    schema: ZodTypeAny
    description?: string
    responseSchema?: ZodTypeAny
    status?: number
  }
  update?: {
    schema: ZodTypeAny
    description?: string
    responseSchema?: ZodTypeAny
  }
  del?: {
    schema?: ZodTypeAny
    description?: string
    responseSchema?: ZodTypeAny
  }
}

export function createExampleCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  const {
    tag = exampleTag,
    resourceName,
    pluralName,
    description,
    querySchema,
    listResponseSchema,
    create,
    update,
    del,
  } = options

  const plural = pluralName ?? `${resourceName}s`
  const methods: NonNullable<OpenApiRouteDoc['methods']> = {}

  methods.GET = {
    summary: `List ${plural.toLowerCase()}`,
    description:
      description ??
      `Returns a paginated collection of ${plural.toLowerCase()} in the current tenant scope.`,
    query: querySchema,
    responses: [
      {
        status: 200,
        description: `Paginated ${plural.toLowerCase()}`,
        schema: listResponseSchema,
      },
    ],
  }

  if (create) {
    methods.POST = {
      summary: `Create ${resourceName.toLowerCase()}`,
      description: create.description ?? `Creates a new ${resourceName.toLowerCase()}.`,
      requestBody: {
        schema: create.schema,
        description: create.description ?? `Payload describing the ${resourceName.toLowerCase()} to create.`,
      },
      responses: [
        {
          status: create.status ?? 201,
          description: `${resourceName} created`,
          schema: create.responseSchema ?? exampleCreatedSchema,
        },
      ],
    }
  }

  if (update) {
    methods.PUT = {
      summary: `Update ${resourceName.toLowerCase()}`,
      description: update.description ?? `Updates an existing ${resourceName.toLowerCase()} by id.`,
      requestBody: {
        schema: update.schema,
        description: update.description ?? `Fields to update on the ${resourceName.toLowerCase()}.`,
      },
      responses: [
        {
          status: 200,
          description: `${resourceName} updated`,
          schema: update.responseSchema ?? exampleOkSchema,
        },
      ],
    }
  }

  if (del) {
    methods.DELETE = {
      summary: `Delete ${resourceName.toLowerCase()}`,
      description: del.description ?? `Deletes a ${resourceName.toLowerCase()} identified by id.`,
      requestBody: del.schema
        ? {
            schema: del.schema,
            description: del.description ?? 'Identifier payload.',
          }
        : undefined,
      responses: [
        {
          status: 200,
          description: `${resourceName} deleted`,
          schema: del.responseSchema ?? exampleOkSchema,
        },
      ],
    }
  }

  return {
    tag,
    summary: `${resourceName} management`,
    methods,
  }
}

