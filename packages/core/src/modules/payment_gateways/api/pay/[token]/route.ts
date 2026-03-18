import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { loadPublicPaymentLinkState } from '../../../lib/public-payment-links'
import { paymentGatewaysTag } from '../../openapi'

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export const metadata = {
  path: '/payment_gateways/pay/[token]',
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

  return NextResponse.json({
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
    transaction: state.transaction
      ? {
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
        }
      : null,
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Read a public payment link',
  methods: {
    GET: {
      summary: 'Get payment link details',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment link details' },
        { status: 403, description: 'Password required' },
        { status: 404, description: 'Payment link not found' },
      ],
    },
  },
}

export default GET
