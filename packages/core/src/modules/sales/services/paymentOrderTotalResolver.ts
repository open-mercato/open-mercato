import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  PaymentGatewayScope,
  PaymentOrderTotal,
  PaymentOrderTotalResolver,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { SalesOrder } from '../data/entities'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toAmount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The amount a gateway session may legitimately charge for an order: what is
 * still due. `outstanding_amount` is recomputed from payments and refunds, so
 * it is the authoritative value once either exists. Orders that were never
 * paid fall back to the grand total, which also covers rows written before
 * outstanding totals were tracked.
 */
export function resolveOrderAmountDue(order: Pick<
  SalesOrder,
  'outstandingAmount' | 'paidTotalAmount' | 'refundedTotalAmount' | 'grandTotalGrossAmount'
>): number {
  const outstanding = toAmount(order.outstandingAmount)
  const paid = toAmount(order.paidTotalAmount)
  const refunded = toAmount(order.refundedTotalAmount)
  if (outstanding > 0 || paid > 0 || refunded > 0) return outstanding
  return toAmount(order.grandTotalGrossAmount)
}

export function createSalesPaymentOrderTotalResolver(deps: { em: EntityManager }): PaymentOrderTotalResolver {
  return {
    async resolveOrderTotal(orderId: string, scope: PaymentGatewayScope): Promise<PaymentOrderTotal | null> {
      if (!UUID_PATTERN.test(orderId) || !scope.tenantId || !scope.organizationId) return null
      const order = await findOneWithDecryption(
        deps.em,
        SalesOrder,
        {
          id: orderId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        {
          fields: [
            'currencyCode',
            'outstandingAmount',
            'paidTotalAmount',
            'refundedTotalAmount',
            'grandTotalGrossAmount',
          ] as const,
        },
        scope,
      )
      if (!order) return null
      return {
        orderId,
        currencyCode: order.currencyCode,
        amountDue: resolveOrderAmountDue(order),
      }
    },
  }
}
