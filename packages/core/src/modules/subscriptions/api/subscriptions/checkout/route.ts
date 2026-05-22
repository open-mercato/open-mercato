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
import { checkoutSchema, type CheckoutInput } from '../../../data/validators'
import { subscriptionsTag } from '../../openapi'

export const metadata = {
  path: '/subscriptions/checkout',
  POST: { requireAuth: true, requireFeatures: ['subscriptions.manage'] },
}

export async function POST(req: Request) {
  try {
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
    const parsed = checkoutSchema.parse(body)

    const actorId = auth.userId ?? auth.sub
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: ctx.selectedOrganizationId,
      userId: actorId,
      resourceKind: 'subscriptions.subscription',
      resourceId: parsed.externalAccountId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<CheckoutInput, {
      checkoutUrl: string
      provider: 'stripe'
      subscriptionRequestId: string
    }>('subscriptions.subscription.checkout', { input: parsed, ctx })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: ctx.selectedOrganizationId,
        userId: actorId,
        resourceKind: 'subscriptions.subscription',
        resourceId: parsed.externalAccountId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({
      checkoutUrl: result.checkoutUrl,
      provider: result.provider,
      subscriptionRequestId: result.subscriptionRequestId,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('subscriptions.checkout failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  checkoutUrl: z.string().url(),
  provider: z.literal('stripe'),
  subscriptionRequestId: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'Create a subscription checkout session',
  methods: {
    POST: {
      summary: 'Create a Stripe Checkout session for a price code',
      tags: [subscriptionsTag],
      requestBody: { schema: checkoutSchema },
      responses: [
        { status: 200, description: 'Checkout URL created', schema: responseSchema },
        { status: 400, description: 'Validation failed' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Price not found or inactive' },
        { status: 409, description: 'Price not yet synced to provider' },
      ],
    },
  },
}

export default POST
