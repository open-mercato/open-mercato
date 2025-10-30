import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from './types'

export const defaultCreateResponseSchema = z.object({ id: z.string().uuid().nullable() })
export const defaultOkResponseSchema = z.object({ ok: z.literal(true) })

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
  })
}

type CrudMethodConfig = {
  schema: ZodTypeAny
  description?: string
  responseSchema?: ZodTypeAny
}

type CrudCreateConfig = CrudMethodConfig & {
  status?: number
}

type CrudDeleteConfig = {
  schema?: ZodTypeAny
  description?: string
  responseSchema?: ZodTypeAny
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
      query: querySchema,
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
      }
    }

    return {
      tag: tag ?? config.defaultTag,
      summary: `${resourceName} management`,
      methods,
    }
  }
}
