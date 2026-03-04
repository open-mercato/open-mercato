import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { GatewayTransaction } from './entities'

type PaymentRecord = Record<string, unknown> & { id: string }

type GatewayEnrichment = {
  _gateway?: {
    providerKey: string
    providerSessionId: string
    providerStatus?: string | null
    unifiedStatus?: string | null
    capturedAmount?: string
    refundedAmount?: string
    providerData?: Record<string, unknown> | null
  } | null
}

const paymentGatewayEnricher: ResponseEnricher<PaymentRecord, GatewayEnrichment> = {
  id: 'payment_gateways.transaction',
  targetEntity: 'sales:sales_payment',
  features: ['payment_gateways.view'],
  priority: 20,
  timeout: 500,
  critical: false,
  fallback: {},

  async enrichOne(record, context) {
    const em = (context.em as any).fork()
    const tx = await em.findOne(GatewayTransaction, {
      paymentId: record.id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    }, {
      orderBy: { createdAt: 'desc' },
    })

    if (!tx) return { ...record, _gateway: null }

    return {
      ...record,
      _gateway: {
        providerKey: tx.providerKey,
        providerSessionId: tx.providerSessionId,
        providerStatus: tx.providerStatus ?? null,
        unifiedStatus: tx.unifiedStatus ?? null,
        capturedAmount: tx.capturedAmount,
        refundedAmount: tx.refundedAmount,
        providerData: tx.providerData ?? null,
      },
    }
  },
}

export const enrichers: ResponseEnricher[] = [paymentGatewayEnricher]
