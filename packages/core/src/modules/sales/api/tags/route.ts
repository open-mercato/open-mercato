import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { SalesDocumentTag } from '../../data/entities'
import { salesTagCreateSchema, salesTagUpdateSchema } from '../../data/validators'
import { buildAggregateSearchFilter, withScopedPayload } from '../utils'
import { createPagedListResponseSchema, createSalesCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'

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

type TagAction = 'view' | 'manage'

// Tags are shared between orders and quotes (both document kinds assign from the same pool), so
// either kind's feature authorizes them. `requireFeatures` metadata is all-of, which cannot say
// "orders OR quotes" — hence the in-handler check, same as the notes route.
const tagFeatureAlternatives: Record<TagAction, string[]> = {
  view: ['sales.orders.view', 'sales.quotes.view'],
  manage: ['sales.orders.manage', 'sales.quotes.manage'],
}

export async function ensureTagPermission(
  ctx: CrudCtx,
  action: TagAction,
  translate: (key: string, fallback?: string) => string,
) {
  const auth = ctx.auth
  if (!auth?.sub) {
    throw new CrudHttpError(401, { error: translate('api.errors.unauthorized', 'Unauthorized') })
  }

  const alternatives = tagFeatureAlternatives[action]
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  const scope = {
    tenantId: auth.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? auth.orgId ?? null,
  }
  for (const feature of alternatives) {
    if (await rbac.userHasAllFeatures(auth.sub, [feature], scope)) return
  }

  // `requiredFeatures` lists the alternatives — holding any one of them is enough.
  throw new CrudHttpError(403, {
    error: translate('api.errors.forbidden', 'Forbidden'),
    requiredFeatures: alternatives,
  })
}

const routeMetadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
  PUT: { requireAuth: true },
  DELETE: { requireAuth: true },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesDocumentTag,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  hooks: {
    beforeList: async (_query, ctx) => {
      const { translate } = await resolveTranslations()
      await ensureTagPermission(ctx, 'view', translate)
    },
  },
  list: {
    schema: listSchema,
    fields: ['id', 'slug', 'label', 'color', 'description', 'organization_id', 'tenant_id'],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      const searchFilter = buildAggregateSearchFilter(query.search)
      if (searchFilter) Object.assign(filters, searchFilter)
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.tags.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        await ensureTagPermission(ctx, 'manage', translate)
        try {
          const scoped = withScopedPayload(raw ?? {}, ctx, translate)
          const slug =
            typeof scoped.slug === 'string' && scoped.slug.trim().length
              ? scoped.slug.trim()
              : typeof scoped.label === 'string'
                ? slugifyTagLabel(scoped.label)
                : scoped.slug
          const payload = { ...scoped, slug }
          return salesTagCreateSchema.parse(payload)
        } catch {
          throw new CrudHttpError(400, { error: translate('sales.errors.tag_invalid', 'Invalid tag payload') })
        }
      },
      response: ({ result }) => ({ id: result?.tagId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.tags.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        await ensureTagPermission(ctx, 'manage', translate)
        try {
          return salesTagUpdateSchema.parse(raw ?? {})
        } catch {
          throw new CrudHttpError(400, { error: translate('sales.errors.tag_invalid', 'Invalid tag payload') })
        }
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.tags.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        await ensureTagPermission(ctx, 'manage', translate)
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('sales.errors.tag_required', 'Tag id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud
export { POST, PUT, DELETE }
export const GET = crud.GET

const tagSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Sales tag',
  pluralName: 'Sales tags',
  description: 'Manage reusable tags to categorize sales orders and quotes.',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(tagSchema),
  create: {
    schema: salesTagCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a sales document tag.',
  },
  update: {
    schema: salesTagUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing sales tag.',
  },
  del: {
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a sales tag.',
  },
})
