import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal } from '../../../../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const reorderSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1),
})

async function resolveAuth(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    throw new CrudHttpError(401, { error: 'Authentication required' })
  }
  return { container, auth }
}

async function checkFeature(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  auth: { sub?: string | null; tenantId?: string | null; orgId?: string | null },
  features: string[],
) {
  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }
  if (!rbac || !auth?.sub) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, features, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
}

export async function POST(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.manage'])

    const em = (container.resolve('em') as EntityManager)
    const decryptionScope = {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    }
    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      { id: parsedParams.data.id, deletedAt: null, tenantId: auth.tenantId, organizationId: auth.orgId },
      {},
      decryptionScope,
    )
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = reorderSchema.parse(body)

    const commandBus = (container.resolve('commandBus') as CommandBus)
    await commandBus.execute(
      'customers.deal-line.reorder',
      {
        input: {
          dealId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          lineIds: parsed.lineIds,
        },
        ctx: { container, auth, organizationScope: null, selectedOrganizationId: auth.orgId ?? null, organizationIds: auth.orgId ? [auth.orgId] : null },
      },
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

const okResponseSchema = z.object({ ok: z.boolean() })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Reorder deal line items',
  methods: {
    POST: {
      summary: 'Reorder deal line items',
      description: 'Updates the display order of line items for a deal.',
      requestBody: { contentType: 'application/json', schema: reorderSchema },
      responses: [
        { status: 200, description: 'Lines reordered', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
  },
}
