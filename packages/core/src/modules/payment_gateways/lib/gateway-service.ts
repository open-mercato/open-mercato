import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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

  async function findTransactionOrThrow(
    transactionId: string,
    scope: { organizationId: string; tenantId: string },
  ): Promise<GatewayTransaction> {
    const transaction = await findOneWithDecryption(
      em,
      GatewayTransaction,
      {
        id: transactionId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (!transaction) {
      throw new Error('Transaction not found')
    }
    return transaction
  }

  function readProviderSessionId(transaction: GatewayTransaction): string {
    if (typeof transaction.providerSessionId === 'string' && transaction.providerSessionId.trim().length > 0) {
      return transaction.providerSessionId
    }
    throw new Error('Transaction is missing provider session id')
  }

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

  async function writeTransactionLog(
    providerKey: string,
    scope: { organizationId: string; tenantId: string },
    transactionId: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    payload?: Record<string, unknown> | null,
    code?: string | null,
  ) {
    if (!integrationLogService) return
    await integrationLogService.write({
      integrationId: `gateway_${providerKey}`,
      scopeEntityType: 'payment_transaction',
      scopeEntityId: transactionId,
      level,
      message,
      code,
      payload: payload ?? null,
    }, scope)
  }

  async function resolveAdapterAndCredentials(providerKey: string, scope: { organizationId: string; tenantId: string }) {
    const integrationId = `gateway_${providerKey}`
    const selectedVersion = deps.integrationStateService
      ? await deps.integrationStateService.resolveApiVersion(integrationId, scope)
      : undefined
    const adapter = getGatewayAdapter(providerKey, selectedVersion)
    if (!adapter) {
      throw new Error(
        selectedVersion
          ? `No gateway adapter registered for provider: ${providerKey} (version: ${selectedVersion})`
          : `No gateway adapter registered for provider: ${providerKey}`,
      )
    }
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
        clientSecret: null,
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
      await writeTransactionLog(
        transaction.providerKey,
        scope,
        transaction.id,
        'info',
        'Payment session created',
        {
          paymentId: transaction.paymentId,
          providerSessionId: transaction.providerSessionId,
          status: transaction.unifiedStatus,
          amount: input.amount,
          currencyCode: input.currencyCode,
        },
      )

      return { transaction, session }
    },

    async capturePayment(transactionId: string, amount: number | undefined, scope: { organizationId: string; tenantId: string }): Promise<CaptureResult> {
      const transaction = await findTransactionOrThrow(transactionId, scope)
      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.capture({
        sessionId: readProviderSessionId(transaction),
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
      await writeTransactionLog(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
        transaction.id,
        'info',
        'Payment captured',
        {
          amount: amount ?? null,
          status: result.status,
          capturedAmount: result.capturedAmount,
        },
      )

      return result
    },

    async refundPayment(
      transactionId: string,
      amount: number | undefined,
      reason: string | undefined,
      scope: { organizationId: string; tenantId: string },
    ): Promise<RefundResult> {
      const transaction = await findTransactionOrThrow(transactionId, scope)
      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.refund({
        sessionId: readProviderSessionId(transaction),
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
      await writeTransactionLog(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
        transaction.id,
        'info',
        'Payment refunded',
        {
          amount: amount ?? null,
          reason: reason ?? null,
          status: result.status,
          refundId: result.refundId,
        },
      )

      return result
    },

    async cancelPayment(
      transactionId: string,
      reason: string | undefined,
      scope: { organizationId: string; tenantId: string },
    ): Promise<CancelResult> {
      const transaction = await findTransactionOrThrow(transactionId, scope)
      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.cancel({
        sessionId: readProviderSessionId(transaction),
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
      await writeTransactionLog(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
        transaction.id,
        'info',
        'Payment cancelled',
        {
          reason: reason ?? null,
          status: result.status,
        },
      )

      return result
    },

    async getPaymentStatus(transactionId: string, scope: { organizationId: string; tenantId: string }): Promise<GatewayPaymentStatus> {
      const transaction = await findTransactionOrThrow(transactionId, scope)
      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const status = await adapter.getStatus({
        sessionId: readProviderSessionId(transaction),
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
        await writeTransactionLog(
          transaction.providerKey,
          { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
          transaction.id,
          'info',
          'Payment status updated by poller',
          {
            previousStatus,
            nextStatus: status.status,
          },
        )
      }

      return status
    },

    async syncTransactionStatus(transactionId: string, update: {
      unifiedStatus: UnifiedPaymentStatus
      providerStatus?: string
      providerData?: Record<string, unknown>
      webhookEvent?: {
        eventType: string
        idempotencyKey: string
        processed: boolean
        receivedAt?: string
      }
    }, scope: { organizationId: string; tenantId: string }): Promise<void> {
      const transaction = await findTransactionOrThrow(transactionId, scope)
      const currentStatus = transaction.unifiedStatus as UnifiedPaymentStatus
      const canTransition = isValidTransition(currentStatus, update.unifiedStatus)
      const shouldApplyStatus = canTransition && update.unifiedStatus !== currentStatus
      const previousStatus = transaction.unifiedStatus
      if (shouldApplyStatus) {
        transaction.unifiedStatus = update.unifiedStatus
      }
      if (update.providerStatus) {
        transaction.gatewayStatus = update.providerStatus
      }
      if (update.providerData) {
        transaction.gatewayMetadata = { ...transaction.gatewayMetadata, ...update.providerData }
      }
      if (update.webhookEvent) {
        const webhookLog = Array.isArray(transaction.webhookLog) ? transaction.webhookLog : []
        webhookLog.push({
          eventType: update.webhookEvent.eventType,
          receivedAt: update.webhookEvent.receivedAt ?? new Date().toISOString(),
          idempotencyKey: update.webhookEvent.idempotencyKey,
          unifiedStatus: update.unifiedStatus,
          processed: update.webhookEvent.processed,
        })
        transaction.webhookLog = webhookLog
      }
      transaction.lastWebhookAt = new Date()
      await em.flush()
      if (shouldApplyStatus) {
        await emitStatusEvent(update.unifiedStatus, {
          transactionId: transaction.id,
          paymentId: transaction.paymentId,
          providerKey: transaction.providerKey,
          previousStatus,
          organizationId: transaction.organizationId,
          tenantId: transaction.tenantId,
        })
      }
      await writeTransactionLog(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
        transaction.id,
        shouldApplyStatus ? 'info' : 'warn',
        shouldApplyStatus ? 'Payment status synchronized from webhook' : 'Webhook received with no status transition',
        {
          previousStatus,
          nextStatus: update.unifiedStatus,
          providerStatus: update.providerStatus ?? null,
          eventType: update.webhookEvent?.eventType ?? null,
          idempotencyKey: update.webhookEvent?.idempotencyKey ?? null,
        },
      )
    },

    async findTransaction(id: string, scope: { organizationId: string; tenantId: string }): Promise<GatewayTransaction | null> {
      return findOneWithDecryption(
        em,
        GatewayTransaction,
        {
          id,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
    },

    async findTransactionBySessionId(
      providerSessionId: string,
      scope: { organizationId: string; tenantId: string },
      providerKey?: string,
    ): Promise<GatewayTransaction | null> {
      return findOneWithDecryption(
        em,
        GatewayTransaction,
        {
          providerSessionId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
          ...(providerKey ? { providerKey } : {}),
        },
        undefined,
        scope,
      )
    },

    async listTransactionsForStatusPolling(scope?: {
      organizationId?: string
      tenantId?: string
      providerKey?: string
      limit?: number
    }): Promise<GatewayTransaction[]> {
      const where: Record<string, unknown> = {
        unifiedStatus: { $in: ['pending', 'authorized', 'partially_captured'] },
        deletedAt: null,
      }
      if (scope?.organizationId) where.organizationId = scope.organizationId
      if (scope?.tenantId) where.tenantId = scope.tenantId
      if (scope?.providerKey) where.providerKey = scope.providerKey

      return findWithDecryption(
        em,
        GatewayTransaction,
        where,
        {
          orderBy: { updatedAt: 'asc' },
          limit: scope?.limit ?? 100,
        },
        scope,
      )
    },
  }
}

export type PaymentGatewayService = ReturnType<typeof createPaymentGatewayService>
