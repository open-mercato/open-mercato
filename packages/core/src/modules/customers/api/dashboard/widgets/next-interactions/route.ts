import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '../../../../data/entities'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  includePast: z.enum(['true', 'false']).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'customers.widgets.next-interactions'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
  includePast: boolean
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
    includePast: parsed.data.includePast === 'true',
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit, includePast } = await resolveContext(req, translate)
    const whereOrganization =
      organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }

    const now = new Date()

    const entities = await em.find(
      CustomerEntity,
      {
        tenantId,
        organizationId: whereOrganization as any,
        deletedAt: null,
        nextInteractionAt: includePast ? { $ne: null } : { $gte: now },
      } as any,
      {
        limit,
        orderBy: { nextInteractionAt: 'asc' as const },
      }
    )

    const items = entities.map((entity) => ({
      id: entity.id,
      displayName: entity.displayName,
      kind: entity.kind,
      organizationId: entity.organizationId,
      nextInteractionAt: entity.nextInteractionAt ? entity.nextInteractionAt.toISOString() : null,
      nextInteractionName: entity.nextInteractionName ?? null,
      ownerUserId: entity.ownerUserId ?? null,
    }))

    return NextResponse.json({ items, now: now.toISOString() })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.widgets.nextInteractions failed', err)
    return NextResponse.json(
      { error: translate('customers.widgets.nextInteractions.error', 'Failed to load upcoming interactions') },
      { status: 500 }
    )
  }
}
