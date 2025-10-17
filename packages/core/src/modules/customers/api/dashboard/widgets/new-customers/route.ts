import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity, type CustomerEntityKind } from '../../../../data/entities'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  kind: z.enum(['person', 'company']).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'customers.widgets.new-customers'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
  kind: CustomerEntityKind | null
}

async function resolveContext(req: Request, translate: (key: string, fallback?: string) => string): Promise<WidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    rawQuery[key] = value
  }
  const parsed = querySchema.safeParse(rawQuery)
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: translate('customers.errors.invalid_query', 'Invalid query parameters') })
  }

  const { em, tenantId, organizationIds } = await resolveWidgetScope(req, translate, {
    tenantId: parsed.data.tenantId ?? null,
    organizationId: parsed.data.organizationId ?? null,
  })

  return {
    em,
    tenantId,
    organizationIds,
    limit: parsed.data.limit,
    kind: parsed.data.kind ?? null,
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit, kind } = await resolveContext(req, translate)
    const whereOrganization =
      organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }

    const where: Record<string, unknown> = {
      tenantId,
      organizationId: whereOrganization as any,
      deletedAt: null,
    }
    if (kind) where.kind = kind

    const entities = await em.find(CustomerEntity, where as any, {
      limit,
      orderBy: { createdAt: 'desc' as const },
    })

    const items = entities.map((entity) => ({
      id: entity.id,
      displayName: entity.displayName,
      kind: entity.kind,
      organizationId: entity.organizationId,
      createdAt: entity.createdAt.toISOString(),
      ownerUserId: entity.ownerUserId ?? null,
    }))

    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.widgets.newCustomers failed', err)
    return NextResponse.json(
      { error: translate('customers.widgets.newCustomers.error', 'Failed to load recently added customers') },
      { status: 500 }
    )
  }
}
