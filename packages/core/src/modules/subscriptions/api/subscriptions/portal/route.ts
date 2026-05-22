import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getPaymentRecurringRuntime } from '@open-mercato/shared/modules/subscriptions/runtime'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GatewaySubscriptionMapping } from '../../../../payment_gateways/data/entities'
import type { CredentialsService } from '../../../../integrations/lib/credentials-service'
import { portalSchema } from '../../../data/validators'
import { loadCredentials } from '../../../lib/subscription-service'
import { subscriptionsTag } from '../../openapi'

export const metadata = {
  path: '/subscriptions/portal',
  POST: { requireAuth: true, requireFeatures: ['subscriptions.manage'] },
}

const PROVIDER_KEY = 'stripe'

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      return NextResponse.json({ error: 'Organization scope required' }, { status: 400 })
    }
    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = portalSchema.parse(body)

    const actorId = auth.userId ?? auth.sub
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId,
      organizationId,
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

    const em = container.resolve('em') as EntityManager
    const mapping = await findOneWithDecryption(
      em,
      GatewaySubscriptionMapping,
      {
        providerKey: PROVIDER_KEY,
        tenantId,
        organizationId,
        externalAccountId: parsed.externalAccountId,
      },
      { orderBy: { createdAt: 'desc' } },
      { tenantId, organizationId },
    )
    if (!mapping) {
      return NextResponse.json({ error: 'No subscription mapping found for externalAccountId' }, { status: 404 })
    }

    const runtime = getPaymentRecurringRuntime(PROVIDER_KEY)
    if (!runtime) {
      return NextResponse.json({ error: 'Stripe recurring runtime not registered' }, { status: 500 })
    }
    const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
    const credentials = await loadCredentials(credentialsService, PROVIDER_KEY, { tenantId, organizationId })

    const portal = await runtime.createBillingPortalSession({
      scope: { tenantId, organizationId },
      customerRef: { providerCustomerId: mapping.providerCustomerId },
      returnUrl: parsed.returnUrl,
      allowPlanSwitching: false,
      credentials,
    })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId,
        organizationId,
        userId: actorId,
        resourceKind: 'subscriptions.subscription',
        resourceId: parsed.externalAccountId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ portalUrl: portal.portalUrl })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('subscriptions.portal failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({ portalUrl: z.string().url() })

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'Create Stripe billing portal session',
  methods: {
    POST: {
      summary: 'Create a Stripe Customer Portal session for an external account',
      tags: [subscriptionsTag],
      requestBody: { schema: portalSchema },
      responses: [
        { status: 200, description: 'Portal session URL', schema: responseSchema },
        { status: 400, description: 'Validation failed' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'No subscription mapping found' },
      ],
    },
  },
}

export default POST
