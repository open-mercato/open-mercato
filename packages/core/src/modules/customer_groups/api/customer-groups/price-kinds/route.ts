import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { listTenantPriceKinds } from '../../../lib/priceKindScope'

const logger = createLogger('customer_groups')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.terms.view'] },
}

const querySchema = z.object({
  search: z.string().max(200).optional(),
  ids: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((id) => id.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()).max(100)),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') },
        { status: 401 },
      )
    }
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') },
        { status: 400 },
      )
    }

    const url = new URL(req.url)
    const parsedQuery = querySchema.safeParse({
      search: url.searchParams.get('search') ?? undefined,
      ids: url.searchParams.get('ids') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.invalid_input', 'Invalid input') },
        { status: 400 },
      )
    }
    const { search, ids, pageSize } = parsedQuery.data

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const items = await listTenantPriceKinds(em, tenantId, { search, ids, limit: pageSize })
    return NextResponse.json({ items })
  } catch (err) {
    logger.error('customer_groups.terms.priceKinds failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.terms_price_kinds_failed' })
    return NextResponse.json(
      { error: translate('customer_groups.errors.load_failed', 'Failed to load commercial terms') },
      { status: 500 },
    )
  }
}

const priceKindOptionSchema = z.object({ id: z.string().uuid(), code: z.string(), title: z.string() })
const priceKindsResponseSchema = z.object({ items: z.array(priceKindOptionSchema) })
const priceKindsErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'List price kinds selectable in commercial terms',
  methods: {
    GET: {
      summary: 'List price kinds selectable in commercial terms',
      description:
        'Returns the tenant’s catalog price kinds (id, code, title) for the commercial terms price kind picker, readable with customer_groups.terms.view instead of catalog.settings.manage. Returns an empty list when the catalog module is not installed.',
      query: z.object({
        search: z.string().optional(),
        ids: z.string().optional().describe('Comma-separated price kind ids'),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      }),
      responses: [{ status: 200, description: 'Selectable price kinds', schema: priceKindsResponseSchema }],
      errors: [
        { status: 400, description: 'Tenant context is required or the query is invalid', schema: priceKindsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: priceKindsErrorSchema },
        { status: 500, description: 'Unexpected failure', schema: priceKindsErrorSchema },
      ],
    },
  },
}
