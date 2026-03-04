import type { EntityManager } from '@mikro-orm/core'
import { SalesPayment } from '../../sales/data/entities'
import type { GatewayPaymentStatus, UnifiedPaymentStatus } from './adapter'
import { GatewayTransaction } from '../data/entities'

function toNumericString(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return String(value)
}

export type CreateGatewayTransactionInput = {
  providerKey: string
  providerVersion?: string | null
  paymentId?: string | null
  orderId?: string | null
  providerSessionId: string
  amount: number
  currencyCode: string
  providerStatus?: string | null
  unifiedStatus?: UnifiedPaymentStatus | null
  providerData?: Record<string, unknown> | null
  tenantId: string
  organizationId: string
}

export type GatewayTransactionService = {
  createOrUpdateFromSession: (input: CreateGatewayTransactionInput) => Promise<GatewayTransaction>
  syncFromGatewayStatus: (input: {
    providerKey: string
    providerSessionId: string
    status: GatewayPaymentStatus
    webhookEventId?: string | null
    tenantId: string
    organizationId: string
  }) => Promise<GatewayTransaction | null>
}

function mergeProviderData(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!previous && !next) return null
  return { ...(previous ?? {}), ...(next ?? {}) }
}

function mapUnifiedToSalesStatus(status: UnifiedPaymentStatus | undefined | null): string | null {
  if (!status) return null
  return status
}

async function updateSalesPaymentFromGatewayStatus(
  em: EntityManager,
  transaction: GatewayTransaction,
  status: GatewayPaymentStatus,
): Promise<void> {
  if (!transaction.paymentId) return
  const payment = await em.findOne(SalesPayment, {
    id: transaction.paymentId,
    tenantId: transaction.tenantId,
    organizationId: transaction.organizationId,
    deletedAt: null,
  })
  if (!payment) return

  payment.status = mapUnifiedToSalesStatus(status.unifiedStatus)
  payment.paymentReference = transaction.providerSessionId

  if (typeof status.capturedAmount === 'number') {
    payment.capturedAmount = toNumericString(status.capturedAmount)
    if (status.capturedAmount > 0 && !payment.capturedAt) {
      payment.capturedAt = new Date()
    }
    if (status.capturedAmount > 0 && !payment.receivedAt) {
      payment.receivedAt = new Date()
    }
  }

  if (typeof status.refundedAmount === 'number') {
    payment.refundedAmount = toNumericString(status.refundedAmount)
  }

  payment.metadata = mergeProviderData(
    (payment.metadata as Record<string, unknown> | null | undefined) ?? null,
    {
      gateway: {
        providerKey: transaction.providerKey,
        providerSessionId: transaction.providerSessionId,
        providerStatus: status.gatewayStatus,
        unifiedStatus: status.unifiedStatus,
      },
    },
  )

  await em.persistAndFlush(payment)
}

export function createGatewayTransactionService(em: EntityManager): GatewayTransactionService {
  return {
    async createOrUpdateFromSession(input) {
      const existing = await em.findOne(GatewayTransaction, {
        providerKey: input.providerKey,
        providerSessionId: input.providerSessionId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })

      if (existing) {
        existing.paymentId = input.paymentId ?? existing.paymentId ?? null
        existing.orderId = input.orderId ?? existing.orderId ?? null
        existing.providerVersion = input.providerVersion ?? existing.providerVersion ?? null
        existing.providerStatus = input.providerStatus ?? existing.providerStatus ?? null
        existing.unifiedStatus = input.unifiedStatus ?? existing.unifiedStatus ?? null
        existing.amount = toNumericString(input.amount)
        existing.currencyCode = input.currencyCode
        existing.providerData = mergeProviderData(existing.providerData ?? null, input.providerData ?? null)
        await em.persistAndFlush(existing)
        return existing
      }

      const created = em.create(GatewayTransaction, {
        providerKey: input.providerKey,
        providerVersion: input.providerVersion ?? null,
        paymentId: input.paymentId ?? null,
        orderId: input.orderId ?? null,
        providerSessionId: input.providerSessionId,
        providerStatus: input.providerStatus ?? null,
        unifiedStatus: input.unifiedStatus ?? null,
        amount: toNumericString(input.amount),
        capturedAmount: '0',
        refundedAmount: '0',
        currencyCode: input.currencyCode,
        providerData: input.providerData ?? null,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })

      await em.persistAndFlush(created)
      return created
    },

    async syncFromGatewayStatus(input) {
      const transaction = await em.findOne(GatewayTransaction, {
        providerKey: input.providerKey,
        providerSessionId: input.providerSessionId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
      })

      if (!transaction) return null
      if (input.webhookEventId && transaction.lastWebhookEventId === input.webhookEventId) {
        return transaction
      }

      transaction.providerStatus = input.status.gatewayStatus
      transaction.unifiedStatus = input.status.unifiedStatus
      if (typeof input.status.capturedAmount === 'number') {
        transaction.capturedAmount = toNumericString(input.status.capturedAmount)
      }
      if (typeof input.status.refundedAmount === 'number') {
        transaction.refundedAmount = toNumericString(input.status.refundedAmount)
      }
      if (input.status.providerData) {
        transaction.providerData = mergeProviderData(transaction.providerData ?? null, input.status.providerData)
      }
      if (input.webhookEventId) {
        transaction.lastWebhookEventId = input.webhookEventId
      }

      await em.persistAndFlush(transaction)
      await updateSalesPaymentFromGatewayStatus(em, transaction, input.status)

      return transaction
    },
  }
}
