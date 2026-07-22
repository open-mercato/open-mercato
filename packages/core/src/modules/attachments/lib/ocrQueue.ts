import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '../data/entities'
import { OcrService } from './ocrService'
import type { StorageDriver } from './drivers/types'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('attachments').child({ component: 'ocr' })

export type OcrRequestedEvent = {
  attachmentId: string
  storagePath: string
  mimeType: string
  partitionCode: string
  organizationId: string | null
  tenantId: string | null
}

export async function processAttachmentOcr(
  em: EntityManager,
  payload: OcrRequestedEvent,
  driver: StorageDriver,
): Promise<void> {
  const { attachmentId, storagePath, mimeType, partitionCode } = payload

  logger.info('Processing started', { attachmentId })
  const startTime = Date.now()

  const { filePath, cleanup } = await driver.toLocalPath(partitionCode, storagePath)
  try {
    const partition = await em.findOne(AttachmentPartition, { code: partitionCode })
    const resolvedModel = partition?.ocrModel ?? process.env.OCR_MODEL ?? 'gpt-4o'

    const ocrService = new OcrService()

    if (!ocrService.available) {
      logger.warn('OPENAI_API_KEY not configured, skipping OCR', { attachmentId })
      return
    }

    const result = await ocrService.processFile({
      filePath,
      mimeType,
      model: resolvedModel,
    })

    if (!result) {
      logger.info('No content extracted', { attachmentId })
      return
    }

    const attachment = await em.findOne(Attachment, { id: attachmentId })
    if (!attachment) {
      logger.error('Attachment not found', { attachmentId })
      return
    }

    attachment.content = result.content
    await em.persist(attachment).flush()

    logger.info('Processing completed', {
      attachmentId,
      pageCount: result.pageCount,
      contentLength: result.content.length,
      timeMs: result.processingTimeMs,
      totalTimeMs: Date.now() - startTime,
    })
  } catch (error) {
    logger.error('Processing failed', { attachmentId, err: error })
  } finally {
    await cleanup().catch((cleanupError) => {
      logger.warn('Temp file cleanup failed', { err: cleanupError })
    })
  }
}

export async function requestOcrProcessing(
  em: EntityManager,
  attachment: Attachment,
  driver: StorageDriver,
  storagePath: string,
): Promise<void> {
  const payload: OcrRequestedEvent = {
    attachmentId: attachment.id,
    storagePath,
    mimeType: attachment.mimeType,
    partitionCode: attachment.partitionCode,
    organizationId: attachment.organizationId ?? null,
    tenantId: attachment.tenantId ?? null,
  }

  if (typeof (em as { fork?: unknown })?.fork !== 'function') {
    throw new Error(
      '[internal] attachments OCR background processing requires an EntityManager that exposes fork(); ' +
        'reusing the request-scoped EntityManager in the async worker would race with later request mutations.',
    )
  }

  const workerEm = em.fork()

  setImmediate(() => {
    processAttachmentOcr(workerEm, payload, driver).catch((error) => {
      logger.error('Background processing error', { err: error })
    })
  })
}
