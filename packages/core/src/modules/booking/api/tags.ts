import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { BookingResourceTag } from '../data/entities'
import { bookingResourceTagCreateSchema, bookingResourceTagUpdateSchema } from '../data/validators'

const rawBodySchema = z.object({}).passthrough()

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
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
  POST: { requireAuth: true, requireFeatures: ['booking.manage_resources'] },
  PUT: { requireAuth: true, requireFeatures: ['booking.manage_resources'] },
  DELETE: { requireAuth: true, requireFeatures: ['booking.manage_resources'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingResourceTag,
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
      commandId: 'booking.resourceTags.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = parseScopedCommandInput(bookingResourceTagCreateSchema, raw ?? {}, ctx, translate)
        const slug =
          typeof scoped.slug === 'string' && scoped.slug.trim().length
            ? scoped.slug.trim()
            : typeof scoped.label === 'string'
              ? slugifyTagLabel(scoped.label)
              : scoped.slug
        return bookingResourceTagCreateSchema.parse({ ...scoped, slug })
      },
      response: ({ result }) => ({ id: result?.tagId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.resourceTags.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        try {
          return bookingResourceTagUpdateSchema.parse(raw ?? {})
        } catch {
          throw new CrudHttpError(400, { error: translate('booking.resources.tags.errors.invalid', 'Invalid tag payload') })
        }
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.resourceTags.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('booking.resources.tags.errors.required', 'Tag id is required') })
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
