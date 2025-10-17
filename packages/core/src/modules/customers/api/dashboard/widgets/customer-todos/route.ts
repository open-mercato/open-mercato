import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity, CustomerTodoLink } from '../../../../data/entities'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'customers.widgets.todos'] },
}

type WidgetContext = WidgetScopeContext & { limit: number }

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
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit } = await resolveContext(req, translate)
    const whereOrganization =
      organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }

    const links = await em.find(
      CustomerTodoLink,
      {
        tenantId,
        organizationId: whereOrganization as any,
        entity: {
          deletedAt: null,
        } as any,
      },
      {
        limit,
        orderBy: { createdAt: 'desc' },
        populate: ['entity'],
      }
    )

    const items = links.map((link) => {
      const entity = link.entity
      const entityRecord = entity && typeof entity !== 'string' ? (entity as CustomerEntity) : null
      return {
        id: link.id,
        todoId: link.todoId,
        todoSource: link.todoSource,
        createdAt: link.createdAt.toISOString(),
        organizationId: link.organizationId,
        entity: entityRecord
          ? {
              id: entityRecord.id,
              displayName: entityRecord.displayName,
              kind: entityRecord.kind,
              ownerUserId: entityRecord.ownerUserId,
            }
          : {
              id: typeof entity === 'string' ? entity : null,
              displayName: null,
              kind: null,
              ownerUserId: null,
            },
      }
    })

    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.widgets.todos failed', err)
    return NextResponse.json(
      { error: translate('customers.widgets.todos.error', 'Failed to load customer tasks') },
      { status: 500 }
    )
  }
}
