import { randomUUID } from 'node:crypto'
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
  type PaymentGatewayPresentationRequest,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import type { IntegrationStateService } from '../../integrations/lib/state-service'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import { conflict } from '@open-mercato/shared/lib/crud/errors'
import { GatewaySessionInitialization, GatewayTransaction } from '../data/entities'
import { canApplyManualAction, isValidTransition, type ManualGatewayAction } from './status-machine'
import { emitPaymentGatewayEvent } from '../events'
import { readGatewayMetadata, readWebhookLog } from './transaction-fields'
import {
  buildPaymentSessionOperationKey,
  claimPaymentSessionInitialization,
  findPaymentSessionInitialization,
  reclaimPaymentSessionInitialization,
  refreshPaymentSessionInitialization,
  releasePaymentSessionInitialization,
} from './session-idempotency'

const PAYMENT_SESSION_CLAIM_STALE_MS = 30_000
const PAYMENT_SESSION_WAIT_INTERVAL_MS = 25

function assertManualActionAllowed(action: ManualGatewayAction, transaction: GatewayTransaction): void {
  const current = transaction.unifiedStatus as UnifiedPaymentStatus
  if (!canApplyManualAction(action, current)) {
    throw conflict(`Cannot ${action} a payment in status "${current}"`)
  }
}

function applyAdapterResultStatus(
  action: ManualGatewayAction,
  transaction: GatewayTransaction,
  resultStatus: UnifiedPaymentStatus,
): boolean {
  const current = transaction.unifiedStatus as UnifiedPaymentStatus
  if (resultStatus === current) return false
  if (!isValidTransition(current, resultStatus)) {
    throw conflict(
      `Gateway returned status "${resultStatus}" which is not a valid transition from "${current}" for ${action}`,
    )
  }
  transaction.unifiedStatus = resultStatus
  return true
}

export interface PaymentGatewayServiceDeps {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationStateService?: IntegrationStateService
  integrationLogService?: IntegrationLogService
  sessionClaimOptions?: {
    staleAfterMs?: number
    heartbeatIntervalMs?: number
    pollIntervalMs?: number
  }
}

export interface CreatePaymentSessionInput {
  providerKey: string
  paymentId: string
  idempotencyKey?: string
  orderId?: string
  amount: number
  currencyCode: string
  captureMethod?: 'automatic' | 'manual'
  paymentTypes?: string[]
  description?: string
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
  presentation?: PaymentGatewayPresentationRequest
  organizationId: string
  tenantId: string
}

export function createPaymentGatewayService(deps: PaymentGatewayServiceDeps) {
  const { em, integrationCredentialsService, integrationLogService } = deps
  const claimStaleAfterMs = Math.max(1, deps.sessionClaimOptions?.staleAfterMs ?? PAYMENT_SESSION_CLAIM_STALE_MS)
  const claimHeartbeatIntervalMs = Math.max(
    1,
    deps.sessionClaimOptions?.heartbeatIntervalMs ?? Math.floor(claimStaleAfterMs / 3),
  )
  const claimPollIntervalMs = Math.max(1, deps.sessionClaimOptions?.pollIntervalMs ?? PAYMENT_SESSION_WAIT_INTERVAL_MS)

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

  function createGatewayTransaction(
    manager: EntityManager,
    input: CreatePaymentSessionInput,
    session: CreateSessionResult,
    id?: string,
  ): GatewayTransaction {
    const data = {
      paymentId: input.paymentId,
      providerKey: input.providerKey,
      providerSessionId: session.sessionId,
      unifiedStatus: session.status,
      redirectUrl: session.redirectUrl
        ?? (session.clientSession?.type === 'redirect' ? session.clientSession.redirectUrl : null),
      clientSecret: session.clientSecret ?? null,
      amount: String(input.amount),
      currencyCode: input.currencyCode,
      gatewayMetadata: {
        ...(session.providerData ?? {}),
        ...(session.clientSession ? { clientSession: session.clientSession } : {}),
      },
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      deletedAt: null,
    }
    return id
      ? manager.create(GatewayTransaction, { id, ...data })
      : manager.create(GatewayTransaction, data)
  }

  function restoreSession(transaction: GatewayTransaction): CreateSessionResult {
    const metadata = readGatewayMetadata(transaction.gatewayMetadata)
    const { clientSession, ...providerData } = metadata
    return {
      sessionId: readProviderSessionId(transaction),
      status: transaction.unifiedStatus as UnifiedPaymentStatus,
      ...(transaction.clientSecret ? { clientSecret: transaction.clientSecret } : {}),
      ...(transaction.redirectUrl ? { redirectUrl: transaction.redirectUrl } : {}),
      ...(Object.keys(providerData).length > 0 ? { providerData } : {}),
      ...(clientSession && typeof clientSession === 'object'
        ? { clientSession: clientSession as CreateSessionResult['clientSession'] }
        : {}),
    }
  }

  async function recordCreatedSession(
    transaction: GatewayTransaction,
    input: CreatePaymentSessionInput,
    scope: { organizationId: string; tenantId: string },
  ): Promise<void> {
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
  }

  function startClaimHeartbeat(
    ownership: { id: string; claimToken: string },
    scope: { organizationId: string; tenantId: string },
  ): () => Promise<void> {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingRefresh = Promise.resolve()

    const schedule = () => {
      timer = setTimeout(() => {
        pendingRefresh = refreshPaymentSessionInitialization(em, ownership, scope, new Date())
          .then((refreshed) => {
            if (refreshed && !stopped) schedule()
          })
      }, claimHeartbeatIntervalMs)
    }
    schedule()

    return async () => {
      stopped = true
      if (timer) clearTimeout(timer)
      await pendingRefresh
    }
  }

  return {
    async createPaymentSession(input: CreatePaymentSessionInput): Promise<{ transaction: GatewayTransaction; session: CreateSessionResult }> {
      const scope = { organizationId: input.organizationId, tenantId: input.tenantId }
      const { adapter, credentials } = await resolveAdapterAndCredentials(input.providerKey, scope)

      const sessionInput: CreateSessionInput = {
        paymentId: input.paymentId,
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        amount: input.amount,
        currencyCode: input.currencyCode,
        captureMethod: input.captureMethod,
        paymentTypes: input.paymentTypes,
        description: input.description,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        metadata: input.metadata,
        presentation: input.presentation,
        credentials,
      }

      if (!input.idempotencyKey) {
        const session = await adapter.createSession(sessionInput)
        const transaction = createGatewayTransaction(em, input, session)
        await em.persist(transaction).flush()
        await recordCreatedSession(transaction, input, scope)
        return { transaction, session }
      }

      const operationKey = buildPaymentSessionOperationKey({
        idempotencyKey: input.idempotencyKey,
        paymentId: input.paymentId,
        providerKey: input.providerKey,
        scope,
      })
      while (true) {
        const existing = await findPaymentSessionInitialization(em, operationKey, input.providerKey, scope)
        if (existing?.gatewayTransactionId) {
          const transaction = await findOneWithDecryption(
            em.fork(),
            GatewayTransaction,
            {
              id: existing.gatewayTransactionId,
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              deletedAt: null,
            },
            undefined,
            scope,
          )
          if (!transaction) {
            throw new Error('Completed payment session is missing its gateway transaction')
          }
          return { transaction, session: restoreSession(transaction) }
        }

        const claimedAt = new Date()
        const staleBefore = new Date(claimedAt.getTime() - claimStaleAfterMs)
        const ownership = existing
          ? await reclaimPaymentSessionInitialization(em, existing, scope, claimedAt, staleBefore)
          : await claimPaymentSessionInitialization(em, operationKey, input.providerKey, scope, claimedAt)

        if (!ownership) {
          await new Promise((resolve) => setTimeout(resolve, claimPollIntervalMs))
          continue
        }

        let session: CreateSessionResult
        const stopHeartbeat = startClaimHeartbeat(ownership, scope)
        try {
          session = await adapter.createSession({ ...sessionInput, idempotencyKey: operationKey })
        } catch (error) {
          await releasePaymentSessionInitialization(em, ownership, scope).catch(() => undefined)
          throw error
        } finally {
          await stopHeartbeat()
        }

        const transactionId = randomUUID()
        const transaction = await em.fork().transactional(async (transactionEm) => {
          const finalizedRows = await transactionEm.nativeUpdate(
            GatewaySessionInitialization,
            {
              id: ownership.id,
              claimToken: ownership.claimToken,
              gatewayTransactionId: null,
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
            },
            {
              gatewayTransactionId: transactionId,
              claimToken: null,
              claimedAt: null,
              updatedAt: new Date(),
            },
          )
          if (finalizedRows === 0) return null
          const created = createGatewayTransaction(transactionEm, input, session, transactionId)
          await transactionEm.persist(created).flush()
          return created
        })

        if (!transaction) {
          continue
        }
        await recordCreatedSession(transaction, input, scope)
        return { transaction, session }
      }
    },

    async capturePayment(transactionId: string, amount: number | undefined, scope: { organizationId: string; tenantId: string }): Promise<CaptureResult> {
      const transaction = await findTransactionOrThrow(transactionId, scope)
      assertManualActionAllowed('capture', transaction)
      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.capture({
        sessionId: readProviderSessionId(transaction),
        amount,
        credentials,
      })

      const statusChanged = applyAdapterResultStatus('capture', transaction, result.status)
      transaction.gatewayMetadata = { ...readGatewayMetadata(transaction.gatewayMetadata), captureResult: result.providerData }
      await em.flush()
      if (statusChanged) {
        await emitStatusEvent(result.status, {
          transactionId: transaction.id,
          paymentId: transaction.paymentId,
          providerKey: transaction.providerKey,
          organizationId: transaction.organizationId,
          tenantId: transaction.tenantId,
        })
      }
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
      assertManualActionAllowed('refund', transaction)
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

      const statusChanged = applyAdapterResultStatus('refund', transaction, result.status)
      transaction.gatewayRefundId = result.refundId
      transaction.gatewayMetadata = { ...readGatewayMetadata(transaction.gatewayMetadata), refundResult: result.providerData }
      await em.flush()
      if (statusChanged) {
        await emitStatusEvent(result.status, {
          transactionId: transaction.id,
          paymentId: transaction.paymentId,
          providerKey: transaction.providerKey,
          organizationId: transaction.organizationId,
          tenantId: transaction.tenantId,
        })
      }
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
      assertManualActionAllowed('cancel', transaction)
      const { adapter, credentials } = await resolveAdapterAndCredentials(
        transaction.providerKey,
        { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
      )

      const result = await adapter.cancel({
        sessionId: readProviderSessionId(transaction),
        reason,
        credentials,
      })

      const statusChanged = applyAdapterResultStatus('cancel', transaction, result.status)
      await em.flush()
      if (statusChanged) {
        await emitStatusEvent(result.status, {
          transactionId: transaction.id,
          paymentId: transaction.paymentId,
          providerKey: transaction.providerKey,
          organizationId: transaction.organizationId,
          tenantId: transaction.tenantId,
        })
      }
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
        transaction.gatewayMetadata = { ...readGatewayMetadata(transaction.gatewayMetadata), statusResult: status.providerData ?? null }
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
        transaction.gatewayMetadata = { ...readGatewayMetadata(transaction.gatewayMetadata), ...update.providerData }
      }
      if (update.webhookEvent) {
        const webhookLog = readWebhookLog(transaction.webhookLog)
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
