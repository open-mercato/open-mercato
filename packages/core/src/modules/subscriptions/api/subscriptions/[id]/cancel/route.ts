import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cancelSchema } from '../../../../data/validators'
import type {
  CancelSubscriptionInput,
  CancelSubscriptionResult,
} from '../../../../commands/cancel'
import { subscriptionsTag } from '../../../openapi'

export const metadata = {
  path: '/subscriptions/[id]/cancel',
  POST: { requireAuth: true, requireFeatures: ['subscriptions.manage'] },
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
    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = cancelSchema.parse(body)
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
      mutationPayload: { ...parsed, subscriptionId },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<CancelSubscriptionInput, CancelSubscriptionResult>(
      'subscriptions.subscription.cancel',
      { input: { subscriptionId, atPeriodEnd: parsed.atPeriodEnd }, ctx },
    )

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

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('subscriptions.cancel failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  ok: z.boolean(),
  subscriptionId: z.string().uuid(),
  providerStatus: z.string(),
  accessState: z.enum(['pending', 'granted', 'grace', 'blocked']),
  cancelAtPeriodEnd: z.boolean(),
  cancelledAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'Cancel a subscription',
  methods: {
    POST: {
      summary: 'Cancel a subscription (at period end by default)',
      tags: [subscriptionsTag],
      requestBody: { schema: cancelSchema },
      responses: [
        { status: 200, description: 'Cancellation accepted', schema: responseSchema },
        { status: 400, description: 'Validation failed' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Subscription not found' },
      ],
    },
  },
}

export default POST
