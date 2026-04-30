import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

const FEATURE = 'customer_accounts.domain.manage'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [FEATURE] },
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService
  const allowed = await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const service = container.resolve('domainMappingService') as DomainMappingService
  const record = await service.findById(id, { tenantId: auth.tenantId })
  if (!record) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

  let updated
  try {
    updated = await service.healthCheck(id)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Health check failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    domainMapping: {
      id: updated.id,
      hostname: updated.hostname,
      status: updated.status,
      tlsRetryCount: updated.tlsRetryCount,
      tlsFailureReason: updated.tlsFailureReason ?? null,
    },
  })
}

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerAccounts',
  summary: 'TLS health check for a custom domain mapping',
  methods: {
    POST: {
      summary: 'Trigger TLS health check',
      description:
        'Runs an HTTPS probe to verify Traefik has provisioned a certificate. On success: transitions the mapping to active.',
      responses: [
        {
          status: 200,
          description: 'OK',
          schema: z.object({
            ok: z.literal(true),
            domainMapping: z.object({
              id: z.string().uuid(),
              hostname: z.string(),
              status: z.string(),
              tlsRetryCount: z.number().int().nonnegative(),
              tlsFailureReason: z.string().nullable(),
            }),
          }),
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 404, description: 'Not found', schema: errorSchema },
      ],
    },
  },
}
