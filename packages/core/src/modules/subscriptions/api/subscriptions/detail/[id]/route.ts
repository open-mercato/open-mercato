import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Subscription, SubscriptionBillingRecord } from '../../../../data/entities'
import { subscriptionsTag } from '../../../openapi'

export const metadata = {
  path: '/subscriptions/detail/[id]',
  GET: { requireAuth: true, requireFeatures: ['subscriptions.admin'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
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
    const resolved = await params
    const em = container.resolve('em') as EntityManager
    const subscription = await findOneWithDecryption(
      em,
      Subscription,
      { id: resolved.id, tenantId, organizationId, deletedAt: null },
      { populate: ['plan', 'price'] },
      { tenantId, organizationId },
    )
    if (!subscription) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const billing = await findWithDecryption(
      em,
      SubscriptionBillingRecord,
      {
        tenantId,
        organizationId,
        subscription,
        deletedAt: null,
      },
      { orderBy: { processedAt: 'desc' }, limit: 50 },
      { tenantId, organizationId },
    )

    return NextResponse.json({
      subscription: {
        id: subscription.id,
        externalAccountId: subscription.externalAccountId,
        subjectEntityType: subscription.subjectEntityType,
        subjectEntityId: subscription.subjectEntityId,
        planCode: subscription.plan?.code ?? null,
        priceCode: subscription.price?.code ?? null,
        productCode: subscription.plan?.productCode ?? null,
        provider: subscription.providerKey,
        providerCustomerId: subscription.providerCustomerId,
        providerSubscriptionId: subscription.providerSubscriptionId ?? null,
        providerStatus: subscription.providerStatus,
        accessState: subscription.accessState,
        currentPeriodStart: subscription.currentPeriodStart ? subscription.currentPeriodStart.toISOString() : null,
        currentPeriodEnd: subscription.currentPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
        trialEndsAt: subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        cancelledAt: subscription.cancelledAt ? subscription.cancelledAt.toISOString() : null,
        lastProviderEventAt: subscription.lastProviderEventAt ? subscription.lastProviderEventAt.toISOString() : null,
        createdAt: subscription.createdAt?.toISOString() ?? null,
        updatedAt: subscription.updatedAt?.toISOString() ?? null,
      },
      billingRecords: billing.map((record) => ({
        id: record.id,
        provider: record.providerKey,
        providerInvoiceId: record.providerInvoiceId ?? null,
        providerChargeId: record.providerChargeId ?? null,
        status: record.status,
        amountMinor: record.amountMinor,
        currencyCode: record.currencyCode,
        periodStart: record.periodStart ? record.periodStart.toISOString() : null,
        periodEnd: record.periodEnd ? record.periodEnd.toISOString() : null,
        eventType: record.eventType,
        processedAt: record.processedAt?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    console.error('subscriptions.detail failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'Get subscription detail (admin)',
  methods: {
    GET: {
      summary: 'Return subscription state + recent billing history',
      tags: [subscriptionsTag],
      responses: [
        { status: 200, description: 'Detail payload' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Not found' },
      ],
    },
  },
}

export default GET
