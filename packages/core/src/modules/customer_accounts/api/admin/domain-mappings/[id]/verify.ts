import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { DomainMappingService, DomainMappingUnavailableError } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

const FEATURE = 'customer_accounts.domain.manage'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [FEATURE] },
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService

  const { id } = await ctx.params
  const service = container.resolve('domainMappingService') as DomainMappingService
  const record = await service.findById(id, { tenantId: auth.tenantId })
  if (!record) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const allowed = await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: record.organizationId,
  })
  if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { tenantId: auth.tenantId, organizationId: record.organizationId, userId: auth.sub },
    input: {
      resourceKind: 'customer_accounts.domain_mapping',
      resourceId: id,
      operation: 'update',
    },
  })
  if (!guardResult.ok) return guardResult.response

  let result
  try {
    result = await service.verify(id)
  } catch (err) {
    if (err instanceof DomainMappingUnavailableError) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'DNS verification failed' },
      { status: 500 },
    )
  }

  await guardResult.runAfterSuccess()

  return NextResponse.json({
    ok: true,
    domainMapping: {
      id: result.domainMapping.id,
      hostname: result.domainMapping.hostname,
      status: result.domainMapping.status,
      verifiedAt: result.domainMapping.verifiedAt?.toISOString() ?? null,
      lastDnsCheckAt: result.domainMapping.lastDnsCheckAt?.toISOString() ?? null,
      dnsFailureReason: result.domainMapping.dnsFailureReason ?? null,
    },
    diagnostics: result.diagnostics ?? null,
  })
}

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerAccounts',
  summary: 'Verify a custom domain mapping (DNS check)',
  methods: {
    POST: {
      summary: 'Trigger DNS verification',
      description:
        'Checks the mapping-specific TXT record and the CNAME, A, or reverse-resolve routing configuration. Returns diagnostics on failure.',
      responses: [
        {
          status: 200,
          description: 'OK — see status',
          schema: z.object({
            ok: z.literal(true),
            domainMapping: z.object({
              id: z.string().uuid(),
              hostname: z.string(),
              status: z.string(),
              verifiedAt: z.string().nullable(),
              lastDnsCheckAt: z.string().nullable(),
              dnsFailureReason: z.string().nullable(),
            }),
            diagnostics: z.unknown().nullable(),
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
