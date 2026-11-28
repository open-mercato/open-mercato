import { z, type ZodTypeAny } from 'zod'
import type { OpenApiResponseDoc, OpenApiRouteDoc } from './types'

/**
 * Keys a write endpoint was asked to set and did not.
 *
 * Present on create and update responses whenever the request carried something the
 * endpoint will not write, so a caller can assert on the response instead of reading
 * the record back. Absent when there is nothing to report.
 */
export const ignoredFieldsResponseSchema = z
  .array(
    z.object({
      key: z.string(),
      reason: z.enum(['unknown', 'immutable', 'misspelled']),
    })
  )
  .optional()

/** The 400 the write guard answers with. Named fields say which keys were at fault. */
export const writeGuardErrorResponse: OpenApiResponseDoc = {
  status: 400,
  description:
    'A field was sent twice with different values, cannot be changed after creation, or is not writable on this endpoint.',
  schema: z.object({
    error: z.string(),
    fields: z.array(z.string()).optional(),
    details: z.string().optional(),
  }),
}

export const defaultCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  ignoredFields: ignoredFieldsResponseSchema,
})
export const defaultOkResponseSchema = z.object({
  ok: z.literal(true),
  ignoredFields: ignoredFieldsResponseSchema,
})

export type PagedListResponseOptions = {
  paginationMetaOptional?: boolean
}

export function createPagedListResponseSchema(itemSchema: ZodTypeAny, options: PagedListResponseOptions = {}) {
  const paginationMetaOptional = options.paginationMetaOptional ?? false

  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: paginationMetaOptional ? z.number().optional() : z.number(),
    pageSize: paginationMetaOptional ? z.number().optional() : z.number(),
    totalPages: z.number(),
    // Present (true) only when the list count was bounded at OM_LIST_COUNT_CAP:
    // `total` is then a floor, not an exact value.
    totalIsCapped: z.boolean().optional(),
  })
}

type CrudMethodConfig = {
  schema: ZodTypeAny
  description?: string
  responseSchema?: ZodTypeAny
  // Route-supplied error responses, merged with the write guard's 400. Delete
  // already had this; create and update need it for the same reason.
  errors?: OpenApiResponseDoc[]
}

type CrudCreateConfig = CrudMethodConfig & {
  status?: number
}

type CrudDeleteConfig = {
  schema?: ZodTypeAny
  description?: string
  responseSchema?: ZodTypeAny
  errors?: OpenApiResponseDoc[]
}

export type CrudOpenApiOptions = {
  tag?: string
  resourceName: string
  pluralName?: string
  description?: string
  querySchema?: ZodTypeAny
  listResponseSchema: ZodTypeAny
  create?: CrudCreateConfig
  update?: CrudMethodConfig
  del?: CrudDeleteConfig
}

export type CrudTextContext = {
  resourceName: string
  resourceLower: string
  pluralName: string
  pluralLower: string
}

export type CrudOpenApiFactoryConfig = {
  defaultTag: string
  defaultCreateResponseSchema?: ZodTypeAny
  defaultOkResponseSchema?: ZodTypeAny
  makeListDescription?: (ctx: CrudTextContext) => string
  makeCreateDescription?: (ctx: CrudTextContext) => string
  makeCreateRequestBodyDescription?: (ctx: CrudTextContext) => string
  makeUpdateDescription?: (ctx: CrudTextContext) => string
  makeUpdateRequestBodyDescription?: (ctx: CrudTextContext) => string
  makeDeleteDescription?: (ctx: CrudTextContext) => string
  makeDeleteRequestBodyDescription?: (ctx: CrudTextContext) => string
}

function withIdsQueryParam(schema: ZodTypeAny | undefined): ZodTypeAny | undefined {
  if (!schema) return schema
  if (!(schema instanceof z.ZodObject)) return schema
  return schema.extend({
    ids: z
      .string()
      .optional()
      .describe('Comma-separated list of record UUIDs to filter by (max 200).'),
  })
}

function resolveDefault(
  factory: ((ctx: CrudTextContext) => string) | undefined,
  ctx: CrudTextContext,
  fallback: string,
) {
  if (typeof factory === 'function') return factory(ctx)
  return fallback
}

export function createCrudOpenApiFactory(config: CrudOpenApiFactoryConfig) {
  return function createCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
    const {
      resourceName,
      pluralName,
      tag,
      description,
      querySchema,
      listResponseSchema,
      create,
      update,
      del,
    } = options

    const plural = pluralName ?? `${resourceName}s`
    const resourceLower = resourceName.toLowerCase()
    const pluralLower = plural.toLowerCase()
    const context: CrudTextContext = {
      resourceName,
      resourceLower,
      pluralName: plural,
      pluralLower,
    }

    const fallbackCreateResponseSchema = config.defaultCreateResponseSchema ?? defaultCreateResponseSchema
    const fallbackOkResponseSchema = config.defaultOkResponseSchema ?? defaultOkResponseSchema

    const methods: NonNullable<OpenApiRouteDoc['methods']> = {}

    methods.GET = {
      summary: `List ${pluralLower}`,
      description:
        description ?? resolveDefault(config.makeListDescription, context, `Returns a paginated collection of ${pluralLower}.`),
      query: withIdsQueryParam(querySchema),
      responses: [
        {
          status: 200,
          description: `Paginated ${pluralLower}`,
          schema: listResponseSchema,
        },
      ],
    }

    if (create) {
      const createDescription =
        create.description ??
        resolveDefault(config.makeCreateDescription, context, `Creates a new ${resourceLower}.`)

      const createBodyDescription =
        resolveDefault(
          config.makeCreateRequestBodyDescription,
          context,
          create.description ?? `Payload describing the ${resourceLower} to create.`,
        )

      methods.POST = {
        summary: `Create ${resourceLower}`,
        description: createDescription,
        requestBody: {
          schema: create.schema,
          description: createBodyDescription,
        },
        responses: [
          {
            status: create.status ?? 201,
            description: `${resourceName} created`,
            schema: create.responseSchema ?? fallbackCreateResponseSchema,
          },
        ],
        errors: [...(create.errors ?? []), writeGuardErrorResponse],
      }
    }

    if (update) {
      const updateDescription =
        update.description ??
        resolveDefault(config.makeUpdateDescription, context, `Updates an existing ${resourceLower} by id.`)

      const updateBodyDescription =
        resolveDefault(
          config.makeUpdateRequestBodyDescription,
          context,
          update.description ?? `Fields to update on the ${resourceLower}.`,
        )

      methods.PUT = {
        summary: `Update ${resourceLower}`,
        description: updateDescription,
        requestBody: {
          schema: update.schema,
          description: updateBodyDescription,
        },
        responses: [
          {
            status: 200,
            description: `${resourceName} updated`,
            schema: update.responseSchema ?? fallbackOkResponseSchema,
          },
        ],
        errors: [...(update.errors ?? []), writeGuardErrorResponse],
      }
    }

    if (del) {
      const deleteDescription =
        del.description ??
        resolveDefault(config.makeDeleteDescription, context, `Deletes a ${resourceLower} identified by id.`)

      const deleteBodyDescription =
        resolveDefault(
          config.makeDeleteRequestBodyDescription,
          context,
          del.description ?? 'Identifier payload.',
        )

      methods.DELETE = {
        summary: `Delete ${resourceLower}`,
        description: deleteDescription,
        requestBody: del.schema
          ? {
              schema: del.schema,
              description: deleteBodyDescription,
            }
          : undefined,
        responses: [
          {
            status: 200,
            description: `${resourceName} deleted`,
            schema: del.responseSchema ?? fallbackOkResponseSchema,
          },
        ],
        ...(del.errors && del.errors.length > 0 ? { errors: del.errors } : {}),
      }
    }

    return {
      tag: tag ?? config.defaultTag,
      summary: `${resourceName} management`,
      methods,
    }
  }
}
