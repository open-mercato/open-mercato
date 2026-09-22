import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { adoptOrphanedCustomerGroups, scanOrphanedCustomerGroupReferences } from '../../../../lib/reconcile'

const logger = createLogger('customer_groups')

// A dedicated POST route (rather than an `?adopt=true` query param on the GET
// above) so the read-only scan never carries side effects — a GET request
// MUST NOT mutate state. Reuses the exact same scan the GET route and the
// `customer_groups reconcile --adopt` CLI command use (`lib/reconcile.ts`), so
// "what would be adopted" and "what gets adopted" can never drift apart.
const CUSTOMER_GROUP_RESOURCE_KIND = 'customer_groups.group'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customer_groups.groups.manage'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })
    }
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') },
        { status: 400 },
      )
    }
    const organizationId = auth.orgId ?? null

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: CUSTOMER_GROUP_RESOURCE_KIND,
      resourceId: tenantId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: {},
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const em = container.resolve<EntityManager>('em')
    const orphans = await scanOrphanedCustomerGroupReferences(em, { tenantId })
    const adopted = await adoptOrphanedCustomerGroups(em, orphans)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: CUSTOMER_GROUP_RESOURCE_KIND,
        resourceId: tenantId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ ok: true, adoptedCount: adopted.length, adopted })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('customer_groups.groups.reconcile.adopt failed', { err })
    return NextResponse.json({ error: 'Failed to adopt orphaned customer group references' }, { status: 400 })
  }
}

const adoptedGroupSchema = z.object({
  groupId: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z.string(),
})
const adoptResponseSchema = z.object({
  ok: z.boolean(),
  adoptedCount: z.number().int().min(0),
  adopted: z.array(adoptedGroupSchema),
})
const adoptErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Adopt orphaned customer-group references',
  methods: {
    POST: {
      summary: 'Adopt orphaned customer-group references',
      description:
        'Creates one inactive placeholder CustomerGroup per orphaned customer_group_id found by the reconciliation scan, reusing that id so existing catalog price / sales tax rate rows resolve.',
      responses: [{ status: 200, description: 'Orphans adopted', schema: adoptResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: adoptErrorSchema },
        { status: 401, description: 'Unauthorized', schema: adoptErrorSchema },
      ],
    },
  },
}
