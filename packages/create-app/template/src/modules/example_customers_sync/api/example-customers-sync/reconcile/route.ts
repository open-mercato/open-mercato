import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { exampleTag } from '../../../../example/api/openapi'
import { reconcileSchema } from '../../../data/validators'
import { EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE, getExampleCustomersSyncQueue } from '../../../lib/queue'
import type { ExampleCustomersSyncReconcileJobPayload } from '../../../lib/sync'

export const metadata = {
  path: '/example-customers-sync/reconcile',
  requireAuth: true,
  requireFeatures: ['example_customers_sync.manage'],
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  /* Manual parsing because readJsonSafe is for outbound fetch responses, not inbound request bodies */
  const text = await request.text()
  if (!text.trim()) return {}
  return JSON.parse(text) as Record<string, unknown>
}

export async function POST(request: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) {
      return NextResponse.json(
        { error: translate('exampleCustomersSync.errors.unauthorized', 'Unauthorized') },
        { status: 401 },
      )
    }

    const rawBody = await readJsonBody(request)
    const body = reconcileSchema.parse(rawBody)
    if (body.tenantId && body.tenantId !== auth.tenantId) {
      return NextResponse.json(
        {
          error: translate(
            'exampleCustomersSync.errors.tenantScopeMismatch',
            'Tenant scope mismatch.',
          ),
        },
        { status: 403 },
      )
    }

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const organizationIds = Array.isArray(scope?.filterIds) && scope.filterIds.length > 0
      ? scope.filterIds
      : auth.orgId
        ? [auth.orgId]
        : []
    const organizationId = body.organizationId ?? scope?.selectedId ?? auth.orgId ?? organizationIds[0] ?? null

    if (!organizationId) {
      return NextResponse.json(
        {
          error: translate(
            'exampleCustomersSync.errors.organizationContextRequired',
            'Organization context is required.',
          ),
        },
        { status: 400 },
      )
    }
    if (organizationIds.length > 0 && !organizationIds.includes(organizationId)) {
      return NextResponse.json(
        {
          error: translate(
            'exampleCustomersSync.errors.organizationScopeMismatch',
            'Organization scope mismatch.',
          ),
        },
        { status: 403 },
      )
    }

    const queue = getExampleCustomersSyncQueue<ExampleCustomersSyncReconcileJobPayload>(
      EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE,
    )
    await queue.enqueue({
      tenantId: auth.tenantId,
      organizationId,
      limit: body.limit,
      cursor: body.cursor,
    })

    return NextResponse.json({ queued: 1 }, { status: 202 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: translate('exampleCustomersSync.errors.invalidJson', 'Invalid JSON body.') },
        { status: 400 },
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: translate('exampleCustomersSync.errors.validationFailed', 'Validation failed'),
          details: error.issues,
        },
        { status: 400 },
      )
    }
    console.error('example-customers-sync.reconcile.post failed', error)
    return NextResponse.json(
      {
        error: translate(
          'exampleCustomersSync.errors.reconcileEnqueueFailed',
          'Failed to enqueue Example customer sync reconciliation.',
        ),
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  methods: {
    POST: {
      summary: 'Backfill or reconcile Example todo mappings to canonical customer interactions',
      tags: [exampleTag],
      requestBody: {
        schema: reconcileSchema,
      },
      responses: [
        {
          status: 202,
          description: 'Reconcile job accepted',
          schema: z.object({ queued: z.number().int().nonnegative() }),
        },
      ],
    },
  },
}
