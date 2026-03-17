import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { applyResponseEnricherToRecord } from '@open-mercato/shared/lib/crud/enricher-runner'
import { PAYMENT_LINK_PAGE_ENRICHER_ENTITY } from '@open-mercato/shared/modules/payment_link_pages/types'
import { loadPublicPaymentLinkState } from '../../../../payment_gateways/lib/public-payment-links'
import { emitPaymentLinkPageEvent } from '../../../events'

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export const metadata = {
  path: '/payment_link_pages/pay/[token]',
  GET: { requireAuth: false },
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> | { token: string } }) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Payment link token is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const state = await loadPublicPaymentLinkState({
    container: container as any,
    req,
    token,
  })
  if (!state) {
    return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
  }

  if (state.passwordRequired) {
    return NextResponse.json({
      passwordRequired: true,
      link: {
        token: state.link.token,
        title: state.link.title,
        description: state.link.description ?? null,
        providerKey: state.link.providerKey,
        status: state.link.status,
      },
    }, { status: 403 })
  }

  await emitPaymentLinkPageEvent('payment_link_pages.page.viewed', {
    paymentLinkId: state.link.id,
    paymentLinkToken: state.link.token,
    transactionId: state.transaction.id,
    paymentId: state.transaction.paymentId,
    providerKey: state.transaction.providerKey,
    organizationId: state.link.organizationId,
    tenantId: state.link.tenantId,
  })

  const baseRecord = {
    passwordRequired: false,
    accessGranted: state.accessGranted,
    link: {
      id: state.link.id,
      token: state.link.token,
      title: state.link.title,
      description: state.link.description ?? null,
      providerKey: state.link.providerKey,
      status: state.link.status,
      completedAt: toIso(state.link.completedAt),
      amount: state.amount,
      currencyCode: state.currencyCode,
      paymentLinkWidgetSpotId: state.paymentLinkWidgetSpotId,
      metadata: state.pageMetadata,
      customFields: state.customFields,
      customFieldsetCode: state.customFieldsetCode,
    },
    transaction: {
      id: state.transaction.id,
      paymentId: state.transaction.paymentId,
      providerKey: state.transaction.providerKey,
      providerSessionId: state.transaction.providerSessionId ?? null,
      unifiedStatus: state.transaction.unifiedStatus,
      gatewayStatus: state.transaction.gatewayStatus ?? null,
      redirectUrl: state.transaction.redirectUrl ?? null,
      clientSecret: state.transaction.clientSecret ?? null,
      amount: Number(state.transaction.amount),
      currencyCode: state.transaction.currencyCode,
      gatewayMetadata: state.transaction.gatewayMetadata ?? null,
      createdAt: toIso(state.transaction.createdAt),
      updatedAt: toIso(state.transaction.updatedAt),
    },
  }

  const enriched = await applyResponseEnricherToRecord(baseRecord, PAYMENT_LINK_PAGE_ENRICHER_ENTITY, {
    organizationId: state.link.organizationId,
    tenantId: state.link.tenantId,
    userId: '',
    em: container.resolve('em') as EntityManager,
    container,
    userFeatures: [],
  })

  return NextResponse.json({
    ...enriched.record,
    _meta: enriched._meta,
  })
}

export const openApi = {
  tags: ['Payment Link Pages'],
  summary: 'Read the UMES-aware public payment link page payload',
  methods: {
    GET: {
      summary: 'Get payment link page payload',
      tags: ['Payment Link Pages'],
      responses: [
        { status: 200, description: 'Payment link page payload' },
        { status: 403, description: 'Password required' },
        { status: 404, description: 'Payment link not found' },
      ],
    },
  },
}

export default GET
