import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { loadPublicPaymentLinkState } from '@open-mercato/pay-by-links/modules/payment_link_pages/lib/public-payment-links'
import { paymentGatewaysTag } from '@open-mercato/core/modules/payment_gateways/api/openapi'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'

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

  // Resolve customer field definitions if a customer fieldset is configured
  let customerFieldDefs: Array<{ key: string; kind: string; label: string; description?: string | null; options?: Array<{ value: string; label: string }>; required?: boolean; group?: { code?: string; title?: string } }> | null = null
  if (state.customerFieldsetCode) {
    try {
      const { resolve } = container
      const customFieldService = resolve('customFieldService') as { getDefinitions?: (entityId: string, fieldset?: string) => Promise<Array<Record<string, unknown>>> } | undefined
      if (customFieldService?.getDefinitions) {
        const defs = await customFieldService.getDefinitions(PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID, state.customerFieldsetCode)
        customerFieldDefs = defs.map((def) => ({
          key: String(def.key ?? ''),
          kind: String(def.kind ?? 'text'),
          label: String(def.label ?? def.key ?? ''),
          description: def.description != null ? String(def.description) : null,
          options: Array.isArray(def.options) ? def.options.map((opt: unknown) => {
            const o = opt as Record<string, unknown>
            return { value: String(o.value ?? ''), label: String(o.label ?? o.value ?? '') }
          }) : undefined,
          required: Array.isArray(def.validation) && (def.validation as Array<Record<string, unknown>>).some((v) => v.type === 'required'),
          group: def.group != null && typeof def.group === 'object' ? { code: String((def.group as Record<string, unknown>).code ?? ''), title: (def.group as Record<string, unknown>).title != null ? String((def.group as Record<string, unknown>).title) : undefined } : undefined,
        }))
      }
    } catch {
      // Silently skip if custom field service unavailable
    }
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
      customerFieldsetCode: state.customerFieldsetCode,
      displayCustomFields: state.displayCustomFields,
      customerFieldValues: state.customerFieldValues,
      completedContent: state.completedContent ?? null,
      customerFieldDefs,
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
