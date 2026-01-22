import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { ResourcesResourceTag } from '../data/entities'
import { resourcesResourceTagCreateSchema, resourcesResourceTagUpdateSchema } from '../data/validators'
import { createResourcesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

const rawBodySchema = z.object({}).passthrough()
const createInputSchema = resourcesResourceTagCreateSchema.extend({
  slug: resourcesResourceTagCreateSchema.shape.slug.optional(),
})

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['resources.view'] },
  POST: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  PUT: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  DELETE: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ResourcesResourceTag,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  list: {
    schema: listSchema,
    fields: ['id', 'slug', 'label', 'color', 'description', 'organization_id', 'tenant_id'],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { label: { $ilike: pattern } },
          { slug: { $ilike: pattern } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'resources.resourceTags.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = parseScopedCommandInput(createInputSchema, raw ?? {}, ctx, translate)
        const slug =
          typeof scoped.slug === 'string' && scoped.slug.trim().length
            ? scoped.slug.trim()
            : typeof scoped.label === 'string'
              ? slugifyTagLabel(scoped.label)
              : scoped.slug
        return resourcesResourceTagCreateSchema.parse({ ...scoped, slug })
      },
      response: ({ result }) => ({ id: result?.tagId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'resources.resourceTags.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        try {
          return resourcesResourceTagUpdateSchema.parse(raw ?? {})
        } catch {
          throw new CrudHttpError(400, { error: translate('resources.resources.tags.errors.invalid', 'Invalid tag payload') })
        }
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'resources.resourceTags.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('resources.resources.tags.errors.required', 'Tag id is required') })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const tagListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  slug: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
})

export const openApi = createResourcesCrudOpenApi({
  resourceName: 'Resource tag',
  pluralName: 'Resource tags',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(tagListItemSchema),
  create: {
    schema: createInputSchema,
    description: 'Creates a tag for resources resources and services.',
  },
  update: {
    schema: resourcesResourceTagUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a resource tag by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a resource tag by id.',
  },
})
