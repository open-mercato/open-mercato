import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getGatewayAdapter,
  type CreateSessionInput,
  type CreateSessionResult,
  type CaptureResult,
  type RefundResult,
  type CancelResult,
  type GatewayPaymentStatus,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import type { IntegrationStateService } from '../../integrations/lib/state-service'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import { GatewayTransaction } from '../data/entities'
import { isValidTransition } from './status-machine'
import { emitPaymentGatewayEvent } from '../events'

export interface PaymentGatewayServiceDeps {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationStateService?: IntegrationStateService
  integrationLogService?: IntegrationLogService
}

export interface CreatePaymentSessionInput {
  providerKey: string
  paymentId: string
  orderId?: string
  amount: number
  currencyCode: string
  captureMethod?: 'automatic' | 'manual'
  description?: string
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
  organizationId: string
  tenantId: string
}

export function createPaymentGatewayService(deps: PaymentGatewayServiceDeps) {
  const { em, integrationCredentialsService, integrationLogService } = deps

  async function emitStatusEvent(status: UnifiedPaymentStatus, payload: Record<string, unknown>) {
    type PaymentGatewayEventId = Parameters<typeof emitPaymentGatewayEvent>[0]
    const eventMap: Partial<Record<UnifiedPaymentStatus, PaymentGatewayEventId>> = {
      authorized: 'payment_gateways.payment.authorized',
      captured: 'payment_gateways.payment.captured',
      failed: 'payment_gateways.payment.failed',
      refunded: 'payment_gateways.payment.refunded',
      cancelled: 'payment_gateways.payment.cancelled',
    }
    const eventId = eventMap[status]
    if (!eventId) return
    await emitPaymentGatewayEvent(eventId, payload)
  }

  async function resolveAdapterAndCredentials(providerKey: string, scope: { organizationId: string; tenantId: string }) {
    const adapter = getGatewayAdapter(providerKey)
    if (!adapter) {
      throw new Error(`No gateway adapter registered for provider: ${providerKey}`)
    }

    const integrationId = `gateway_${providerKey}`
    const credentials = await integrationCredentialsService.resolve(integrationId, scope) ?? {}

    return { adapter, credentials }
  }

  return {
    async createPaymentSession(input: CreatePaymentSessionInput): Promise<{ transaction: GatewayTransaction; session: CreateSessionResult }> {
      const scope = { organizationId: input.organizationId, tenantId: input.tenantId }
      const { adapter, credentials } = await resolveAdapterAndCredentials(input.providerKey, scope)

      const sessionInput: CreateSessionInput = {
        paymentId: input.paymentId,
        orderId: input.orderId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        amount: input.amount,
        currencyCode: input.currencyCode,
        captureMethod: input.captureMethod,
        description: input.description,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        metadata: input.metadata,
        credentials,
      }

      const session = await adapter.createSession(sessionInput)

      const transaction = em.create(GatewayTransaction, {
        paymentId: input.paymentId,
        providerKey: input.providerKey,
        providerSessionId: session.sessionId,
        unifiedStatus: session.status,
        redirectUrl: session.redirectUrl ?? null,
        clientSecret: session.clientSecret ?? null,
        amount: String(input.amount),
        currencyCode: input.currencyCode,
        gatewayMetadata: session.providerData ?? null,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      await em.persistAndFlush(transaction)
      await emitPaymentGatewayEvent('payment_gateways.session.created', {
        transactionId: transaction.id,
        paymentId: transaction.paymentId,
        providerKey: transaction.providerKey,
        status: transaction.unifiedStatus,
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })

      return { transaction, session }
    },

    async capturePayment(transactionId: string, amount?: number, scope?: { organizationId: string; tenantId: string }): Promise<CaptureResult> {
      const transaction = await em.findOneOrFail(GatewayTransaction, { id: transactionId })
      if (scope && transaction.organizationId !== scope.organizationId) {
        throw new Error('Access denied: cross-tenant operation')
      }

      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.capture({
        sessionId: transaction.providerSessionId!,
        amount,
        credentials,
      })

      transaction.unifiedStatus = result.status
      transaction.gatewayMetadata = { ...transaction.gatewayMetadata, captureResult: result.providerData }
      await em.flush()
      await emitStatusEvent(result.status, {
        transactionId: transaction.id,
        paymentId: transaction.paymentId,
        providerKey: transaction.providerKey,
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })

      return result
    },

    async refundPayment(transactionId: string, amount?: number, reason?: string, scope?: { organizationId: string; tenantId: string }): Promise<RefundResult> {
      const transaction = await em.findOneOrFail(GatewayTransaction, { id: transactionId })
      if (scope && transaction.organizationId !== scope.organizationId) {
        throw new Error('Access denied: cross-tenant operation')
      }

      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.refund({
        sessionId: transaction.providerSessionId!,
        amount,
        reason,
        credentials,
      })

      transaction.unifiedStatus = result.status
      transaction.gatewayRefundId = result.refundId
      transaction.gatewayMetadata = { ...transaction.gatewayMetadata, refundResult: result.providerData }
      await em.flush()
      await emitStatusEvent(result.status, {
        transactionId: transaction.id,
        paymentId: transaction.paymentId,
        providerKey: transaction.providerKey,
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })

      return result
    },

    async cancelPayment(transactionId: string, reason?: string, scope?: { organizationId: string; tenantId: string }): Promise<CancelResult> {
      const transaction = await em.findOneOrFail(GatewayTransaction, { id: transactionId })
      if (scope && transaction.organizationId !== scope.organizationId) {
        throw new Error('Access denied: cross-tenant operation')
      }

      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.cancel({
        sessionId: transaction.providerSessionId!,
        reason,
        credentials,
      })

      transaction.unifiedStatus = result.status
      await em.flush()
      await emitStatusEvent(result.status, {
        transactionId: transaction.id,
        paymentId: transaction.paymentId,
        providerKey: transaction.providerKey,
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })

      return result
    },

    async getPaymentStatus(transactionId: string, scope?: { organizationId: string; tenantId: string }): Promise<GatewayPaymentStatus> {
      const transaction = await em.findOneOrFail(GatewayTransaction, { id: transactionId })
      if (scope && transaction.organizationId !== scope.organizationId) {
        throw new Error('Access denied: cross-tenant operation')
      }

      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const status = await adapter.getStatus({
        sessionId: transaction.providerSessionId!,
        credentials,
      })

      if (status.status !== transaction.unifiedStatus && isValidTransition(transaction.unifiedStatus as UnifiedPaymentStatus, status.status)) {
        const previousStatus = transaction.unifiedStatus
        transaction.unifiedStatus = status.status
        transaction.gatewayStatus = status.status
        transaction.gatewayMetadata = { ...transaction.gatewayMetadata, statusResult: status.providerData ?? null }
        transaction.lastPolledAt = new Date()
        await em.flush()
        await emitStatusEvent(status.status, {
          transactionId: transaction.id,
          paymentId: transaction.paymentId,
          providerKey: transaction.providerKey,
          previousStatus,
          organizationId: transaction.organizationId,
          tenantId: transaction.tenantId,
        })
        if (integrationLogService) {
          await integrationLogService.scoped(`gateway_${transaction.providerKey}`, {
            organizationId: transaction.organizationId,
            tenantId: transaction.tenantId,
          }).info('Payment status updated by poller', {
            transactionId: transaction.id,
            previousStatus,
            nextStatus: status.status,
          })
        }
      }

      return status
    },

    async syncTransactionStatus(transactionId: string, update: {
      unifiedStatus: UnifiedPaymentStatus
      providerStatus?: string
      providerData?: Record<string, unknown>
    }): Promise<void> {
      const transaction = await em.findOneOrFail(GatewayTransaction, { id: transactionId })
      const currentStatus = transaction.unifiedStatus as UnifiedPaymentStatus

      if (!isValidTransition(currentStatus, update.unifiedStatus)) {
        return
      }

      const previousStatus = transaction.unifiedStatus
      transaction.unifiedStatus = update.unifiedStatus
      if (update.providerStatus) {
        transaction.gatewayStatus = update.providerStatus
      }
      if (update.providerData) {
        transaction.gatewayMetadata = { ...transaction.gatewayMetadata, ...update.providerData }
      }
      transaction.lastWebhookAt = new Date()
      await em.flush()
      await emitStatusEvent(update.unifiedStatus, {
        transactionId: transaction.id,
        paymentId: transaction.paymentId,
        providerKey: transaction.providerKey,
        previousStatus,
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })
    },

    async findTransaction(id: string): Promise<GatewayTransaction | null> {
      return em.findOne(GatewayTransaction, { id })
    },

    async findTransactionBySessionId(providerSessionId: string, providerKey?: string): Promise<GatewayTransaction | null> {
      return em.findOne(GatewayTransaction, {
        providerSessionId,
        ...(providerKey ? { providerKey } : {}),
      })
    },

    async listTransactionsForStatusPolling(scope?: {
      organizationId?: string
      tenantId?: string
      providerKey?: string
      limit?: number
    }): Promise<GatewayTransaction[]> {
      const where: Record<string, unknown> = {
        unifiedStatus: { $in: ['pending', 'authorized', 'partially_captured'] },
      }
      if (scope?.organizationId) where.organizationId = scope.organizationId
      if (scope?.tenantId) where.tenantId = scope.tenantId
      if (scope?.providerKey) where.providerKey = scope.providerKey

      return em.find(GatewayTransaction, where, {
        orderBy: { updatedAt: 'asc' },
        limit: scope?.limit ?? 100,
      })
    },
  }
}

export type PaymentGatewayService = ReturnType<typeof createPaymentGatewayService>
