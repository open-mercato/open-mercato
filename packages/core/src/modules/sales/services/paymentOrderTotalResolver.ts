import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  PaymentGatewayScope,
  PaymentOrderTotal,
  PaymentOrderTotalResolver,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { decimalToNumber, decimalToString, parseDecimal, toDecimal } from '@open-mercato/shared/lib/decimal'
import { SalesOrder } from '../data/entities'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toAmount(value: string | number | null | undefined) {
  return parseDecimal(value) ?? toDecimal(0)
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
  return decimalToNumber(resolveOrderAmountDueExact(order))
}

/** Exact-decimal variant of {@link resolveOrderAmountDue}. */
export function resolveOrderAmountDueExact(order: Pick<
  SalesOrder,
  'outstandingAmount' | 'paidTotalAmount' | 'refundedTotalAmount' | 'grandTotalGrossAmount'
>): string {
  const outstanding = toAmount(order.outstandingAmount)
  const paid = toAmount(order.paidTotalAmount)
  const refunded = toAmount(order.refundedTotalAmount)
  if (outstanding.gt(0) || paid.gt(0) || refunded.gt(0)) return decimalToString(outstanding)
  return decimalToString(toAmount(order.grandTotalGrossAmount))
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
        amountDueExact: resolveOrderAmountDueExact(order),
      }
    },
  }
}
