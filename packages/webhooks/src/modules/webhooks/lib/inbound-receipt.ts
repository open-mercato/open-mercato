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

  let duplicate = true
  if (sourceKey) {
    const dispatch = await em.fork().transactional(async (transaction) => {
      const receipt = await findOneWithDecryption(transaction, WebhookInboundReceiptEntity, receiptWhere, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      })
      if (!receipt) throw new Error('[internal] Inbound receipt not found in verified scope')
      if (receipt.dispatchQueued) return receipt.receivedEventPublished ? 'complete' : 'pending'
      if (!receipt.ingestionId || !input.tenantId || !input.organizationId) {
        throw new Error('[internal] Inbound receipt has no scoped ingestion')
      }
      await enqueueInboundDispatch({
        ingestionId: receipt.ingestionId,
        sourceKey,
        eventType: receipt.eventType ?? input.eventType,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }, { startLocalWorker: false })
      receipt.dispatchQueued = true
      return 'queued'
    })
    if (dispatch === 'complete') return true
    duplicate = dispatch !== 'queued'
    await ensureLocalInboundQueueWorkerStarted()
  }

  const published = await em.fork().transactional(async (transaction) => {
    const receipt = await findOneWithDecryption(transaction, WebhookInboundReceiptEntity, receiptWhere, {
      lockMode: LockMode.PESSIMISTIC_WRITE,
    })
    if (!receipt) throw new Error('[internal] Inbound receipt not found in verified scope')
    if (!receipt.dispatchQueued) throw new Error('[internal] Inbound receipt dispatch is not queued')
    if (receipt.receivedEventPublished) return false
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
    await emitWebhooksEvent('webhooks.inbound.received', {
      providerKey: receipt.providerKey,
      endpointId: input.endpointId,
      messageId: input.messageId,
      eventType: receipt.eventType ?? input.eventType,
      payload: ingestion?.payload ?? input.payload,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }, { persistent: true })
    receipt.receivedEventPublished = true
    return true
  })

  return duplicate && !published
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; cause?: unknown }
  if (candidate.code === '23505') return true
  return Boolean(candidate.cause && typeof candidate.cause === 'object'
    && (candidate.cause as { code?: string }).code === '23505')
}
