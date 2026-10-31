import { randomUUID } from 'node:crypto'
import { LockMode, type EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WebhookIngestionEntity, WebhookInboundReceiptEntity } from '../data/entities'
import { emitWebhooksEvent } from '../events'
import { enqueueInboundDispatch, ensureLocalInboundQueueWorkerStarted } from './queue'

type InboundReceiptInput = {
  endpointId: string
  messageId: string
  providerKey: string
  eventType: string
  payload: Record<string, unknown>
  headers: Record<string, string>
  tenantId: string | null
  organizationId: string | null
  sourceKey?: string
}

export async function receiveInboundWebhook(em: EntityManager, input: InboundReceiptInput): Promise<boolean> {
  const sourceKey = input.sourceKey
  const receiptWhere = {
    endpointId: input.endpointId,
    messageId: input.messageId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  }

  try {
    await em.fork().transactional(async (transaction) => {
      const existing = await findOneWithDecryption(transaction, WebhookInboundReceiptEntity, receiptWhere)
      if (existing) return

      const ingestionId = sourceKey ? randomUUID() : null
      if (sourceKey && ingestionId) {
        if (!input.tenantId || !input.organizationId) {
          throw new Error('[internal] Inbound source requires a tenant and organization')
        }
        transaction.persist(transaction.create(WebhookIngestionEntity, {
          id: ingestionId,
          sourceKey,
          eventType: input.eventType,
          externalMessageId: input.messageId,
          payload: input.payload,
          headers: input.headers,
          status: 'received',
          handlerCount: 0,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      }
      transaction.persist(transaction.create(WebhookInboundReceiptEntity, {
        ...receiptWhere,
        providerKey: input.providerKey,
        eventType: input.eventType,
        ingestionId,
        dispatchQueued: !sourceKey,
        receivedEventPublished: false,
        createdAt: new Date(),
      }))
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
  }

  const deadline = Date.now() + 5_000
  let duplicate = true
  for (const stage of ['dispatch', 'received_event'] as const) {
    while (true) {
      const claim = await em.fork().transactional(async (transaction) => {
        const receipt = await findOneWithDecryption(transaction, WebhookInboundReceiptEntity, receiptWhere, {
          lockMode: LockMode.PESSIMISTIC_WRITE,
        })
        if (!receipt) throw new Error('[internal] Inbound receipt not found in verified scope')
        if (stage === 'dispatch' ? receipt.dispatchQueued : receipt.receivedEventPublished) {
          return { state: 'complete', startWorker: stage === 'dispatch' && Boolean(sourceKey) && !receipt.receivedEventPublished } as const
        }
        if (stage === 'dispatch' && !sourceKey) {
          throw new Error('[internal] Inbound receipt dispatch is not queued')
        }
        if (stage === 'received_event' && !receipt.dispatchQueued) {
          throw new Error('[internal] Inbound receipt dispatch is not queued')
        }
        if (receipt.deliveryClaimToken && receipt.deliveryClaimExpiresAt
          && receipt.deliveryClaimExpiresAt.getTime() > Date.now()) {
          return { state: 'waiting' } as const
        }
        const ingestion = receipt.ingestionId
          ? await findOneWithDecryption(transaction, WebhookIngestionEntity, {
            id: receipt.ingestionId,
            tenantId: input.tenantId,
            organizationId: input.organizationId,
          })
          : null
        if (receipt.ingestionId && !ingestion) {
          throw new Error('[internal] Inbound ingestion not found in verified scope')
        }
        if (stage === 'dispatch' && (!receipt.ingestionId || !input.tenantId || !input.organizationId)) {
          throw new Error('[internal] Inbound receipt has no scoped ingestion')
        }
        const token = randomUUID()
        receipt.deliveryClaimToken = token
        receipt.deliveryClaimStage = stage
        receipt.deliveryClaimExpiresAt = new Date(Date.now() + 30_000)
        return {
          state: 'owned', token, receiptId: receipt.id, ingestionId: receipt.ingestionId,
          providerKey: receipt.providerKey, eventType: receipt.eventType ?? input.eventType,
          payload: ingestion?.payload ?? input.payload,
        } as const
      })
      if (claim.state === 'complete') {
        if (claim.startWorker) await ensureLocalInboundQueueWorkerStarted()
        break
      }
      const remainingMs = deadline - Date.now()
      if (claim.state === 'waiting') {
        if (remainingMs <= 0) throw new Error('[internal] Inbound receipt publication is still pending; retry delivery')
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)))
        continue
      }

      const checkpoint = async (completed: boolean): Promise<boolean> => em.fork().transactional(async (transaction) => {
        const receipt = await findOneWithDecryption(transaction, WebhookInboundReceiptEntity, {
          ...receiptWhere, deliveryClaimToken: claim.token, deliveryClaimStage: stage,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!receipt || !receipt.deliveryClaimExpiresAt || receipt.deliveryClaimExpiresAt.getTime() <= Date.now()) return false
        if (completed) {
          if (stage === 'dispatch') receipt.dispatchQueued = true
          else receipt.receivedEventPublished = true
        }
        receipt.deliveryClaimToken = null
        receipt.deliveryClaimStage = null
        receipt.deliveryClaimExpiresAt = null
        return true
      })

      try {
        if (remainingMs <= 0) throw new Error('[internal] Inbound receipt publication deadline exceeded; retry delivery')
        await publishBeforeDeadline(async () => {
          const jobId = `webhook-receipt-${claim.receiptId}-${stage}`
          if (stage === 'dispatch') {
            await enqueueInboundDispatch({
              ingestionId: claim.ingestionId!, sourceKey: sourceKey!, eventType: claim.eventType,
              tenantId: input.tenantId!, organizationId: input.organizationId!,
            }, { startLocalWorker: false, jobId, timeoutMs: remainingMs })
          } else {
            await emitWebhooksEvent('webhooks.inbound.received', {
              providerKey: claim.providerKey, endpointId: input.endpointId, messageId: input.messageId,
              eventType: claim.eventType, payload: claim.payload,
              tenantId: input.tenantId, organizationId: input.organizationId,
            }, { persistent: true, enqueue: { jobId, timeoutMs: remainingMs } })
          }
        }, remainingMs)
        if (!await checkpoint(true)) {
          throw new Error('[internal] Inbound receipt publication claim expired; retry delivery')
        }
        duplicate = false
      } catch (error) {
        await checkpoint(false)
        throw error
      }
      if (stage === 'dispatch') await ensureLocalInboundQueueWorkerStarted()
      break
    }
  }
  return duplicate
}

async function publishBeforeDeadline(operation: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('[internal] Inbound publication timed out; outcome is uncertain; retry delivery')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; cause?: unknown }
  if (candidate.code === '23505') return true
  return Boolean(candidate.cause && typeof candidate.cause === 'object'
    && (candidate.cause as { code?: string }).code === '23505')
}
