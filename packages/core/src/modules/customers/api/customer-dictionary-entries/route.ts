import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CustomerDictionaryEntry } from '../../data/entities'
import { resolveDictionaryRouteContext } from '../dictionaries/context'
import { createPagedListResponseSchema } from '../openapi'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(150).optional(),
  id: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.settings.manage', 'translations.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      id: url.searchParams.get('id') ?? undefined,
    })
    const { em, tenantId, organizationId, translate } = await resolveDictionaryRouteContext(req)
    if (!organizationId) {
      return NextResponse.json({ error: translate('customers.errors.organization_required', 'Organization context is required') }, { status: 400 })
    }
    const where: FilterQuery<CustomerDictionaryEntry> = {
      tenantId,
      organizationId,
      ...(query.id ? { id: query.id } : {}),
      ...(query.search ? { label: { $ilike: `%${escapeLikePattern(query.search)}%` } } : {}),
    }
    const total = await em.count(CustomerDictionaryEntry, where)
    const entries = await findWithDecryption(em, CustomerDictionaryEntry, where, {
      orderBy: { kind: 'asc', label: 'asc', id: 'asc' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }, { tenantId, organizationId })
    return NextResponse.json({
      items: entries.map(({ id, kind, value, label, updatedAt }) => ({ id, kind, value, label, updatedAt })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    if (error instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json({ error: translate('customers.errors.invalid_query', 'Invalid query parameters') }, { status: 400 })
    }
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer dictionary translation records',
  methods: {
    GET: {
      summary: 'List base labels for translation management',
      query: querySchema,
      responses: [{
        status: 200,
        description: 'Dictionary entries in the selected organization with their stored base labels',
        schema: createPagedListResponseSchema(z.object({
          id: z.string().uuid(), kind: z.string(), value: z.string(), label: z.string(), updatedAt: z.string(),
        })),
      }],
    },
  },
}
