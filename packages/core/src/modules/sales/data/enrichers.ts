import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { GatewayTransaction } from '../../payment_gateways/data/entities'

type SalesPaymentRecord = Record<string, unknown> & {
  id?: string
  paymentId?: string
}

function readPaymentId(record: SalesPaymentRecord): string | null {
  if (typeof record.id === 'string' && record.id.trim().length > 0) return record.id
  if (typeof record.paymentId === 'string' && record.paymentId.trim().length > 0) return record.paymentId
  return null
}

const paymentGatewayBindingEnricher: ResponseEnricher<SalesPaymentRecord> = {
  id: 'sales.payment-gateway-binding',
  targetEntity: 'sales.payment',
  priority: 40,
  timeout: 2000,

  async enrichOne(record, context) {
    try {
      const paymentId = readPaymentId(record)
      if (!paymentId) return record
      const transaction = await context.em.findOne(GatewayTransaction, {
        paymentId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      }, { orderBy: { createdAt: 'desc' } })
      if (!transaction) return record

      return {
        ...record,
        _gateway: {
          transactionId: transaction.id,
          unifiedStatus: transaction.unifiedStatus,
          gatewayStatus: transaction.gatewayStatus ?? null,
          providerKey: transaction.providerKey,
          providerSessionId: transaction.providerSessionId ?? null,
        },
      }
    } catch {
      // payment_gateways module may be disabled; fail-open
      return record
    }
  },

  async enrichMany(records, context) {
    try {
      const paymentIds = records.map(readPaymentId).filter((value): value is string => Boolean(value))
      if (paymentIds.length === 0) return records

      const transactions = await context.em.find(GatewayTransaction, {
        paymentId: { $in: paymentIds },
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      }, { orderBy: { createdAt: 'desc' } })

      const latestByPaymentId = new Map<string, GatewayTransaction>()
      for (const transaction of transactions) {
        if (!latestByPaymentId.has(transaction.paymentId)) {
          latestByPaymentId.set(transaction.paymentId, transaction)
        }
      }

      return records.map((record) => {
        const paymentId = readPaymentId(record)
        if (!paymentId) return record
        const transaction = latestByPaymentId.get(paymentId)
        if (!transaction) return record
        return {
          ...record,
          _gateway: {
            transactionId: transaction.id,
            unifiedStatus: transaction.unifiedStatus,
            gatewayStatus: transaction.gatewayStatus ?? null,
            providerKey: transaction.providerKey,
            providerSessionId: transaction.providerSessionId ?? null,
          },
        }
      })
    } catch {
      // payment_gateways module may be disabled; fail-open
      return records
    }
  },
}

export const enrichers: ResponseEnricher[] = [paymentGatewayBindingEnricher]
