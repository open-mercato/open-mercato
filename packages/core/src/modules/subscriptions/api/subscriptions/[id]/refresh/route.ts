import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { subscriptionsTag } from '../../../openapi'

export const metadata = {
  path: '/subscriptions/[id]/refresh',
  POST: { requireAuth: true, requireFeatures: ['subscriptions.admin'] },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const resolved = await params
    const subscriptionId = resolved.id
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }
    const actorId = auth.userId ?? auth.sub
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: ctx.selectedOrganizationId,
      userId: actorId,
      resourceKind: 'subscriptions.subscription',
      resourceId: subscriptionId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { subscriptionId },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute('subscriptions.subscription.refresh', {
      input: { subscriptionId },
      ctx,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: ctx.selectedOrganizationId,
        userId: actorId,
        resourceKind: 'subscriptions.subscription',
        resourceId: subscriptionId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const responseBody = result && typeof result === 'object' && !Array.isArray(result)
      ? { ok: true, ...(result as Record<string, unknown>) }
      : { ok: true, result }
    return NextResponse.json(responseBody)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('subscriptions.refresh failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'Force refresh a subscription from the provider',
  methods: {
    POST: {
      summary: 'Pull a fresh subscription snapshot from the provider and apply it locally',
      tags: [subscriptionsTag],
      responses: [
        { status: 200, description: 'Refresh completed' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Subscription not found' },
      ],
    },
  },
}

export default POST
