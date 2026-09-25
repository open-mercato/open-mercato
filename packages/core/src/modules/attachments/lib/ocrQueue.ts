import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '../data/entities'
import { OcrService } from './ocrService'
import type { StorageDriver } from './drivers/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOcrMaxConcurrency, resolveOcrMaxWaitQueue } from './ocrLimits'
import { extractAttachmentContent } from './textExtraction'

const logger = createLogger('attachments').child({ component: 'ocr' })

export type OcrRequestedEvent = {
  attachmentId: string
  storagePath: string
  mimeType: string
  partitionCode: string
  organizationId: string | null
  tenantId: string | null
}

/** Outcome of `requestOcrProcessing` — background LLM OCR vs inline text fallback. */
export type OcrProcessingDispatch = 'queued' | 'inline_fallback'

let activeOcrJobs = 0
const ocrWaitQueue: Array<() => void> = []

/** Test-only: reset in-process OCR concurrency bookkeeping. */
export function resetOcrConcurrencyStateForTests(): void {
  activeOcrJobs = 0
  ocrWaitQueue.length = 0
}

/** Test-only: inspect in-process OCR concurrency counters. */
export function getOcrConcurrencyStateForTests(): { active: number; waiting: number } {
  return { active: activeOcrJobs, waiting: ocrWaitQueue.length }
}

export async function withOcrConcurrencySlot<T>(run: () => Promise<T>): Promise<T> {
  const maxConcurrency = resolveOcrMaxConcurrency()
  // Re-check after wake: multiple waiters can resume when one slot frees (barging).
  while (activeOcrJobs >= maxConcurrency) {
    await new Promise<void>((resolve) => {
      ocrWaitQueue.push(resolve)
    })
  }
  activeOcrJobs += 1
  try {
    return await run()
  } finally {
    activeOcrJobs -= 1
    const next = ocrWaitQueue.shift()
    if (next) next()
  }
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

/**
 * When the in-process OCR wait queue is full, extract plain text/PDF/DOCX content
 * inline (no LLM) so `attachment.content` is not left NULL forever.
 */
async function persistInlineTextExtractionFallback(
  em: EntityManager,
  payload: OcrRequestedEvent,
  driver: StorageDriver,
): Promise<void> {
  const { attachmentId, storagePath, mimeType, partitionCode } = payload
  const { filePath, cleanup } = await driver.toLocalPath(partitionCode, storagePath)
  try {
    const content = await extractAttachmentContent({ filePath, mimeType })
    if (!content) {
      logger.info('OCR wait queue full; inline extraction produced no content', { attachmentId })
      return
    }
    const row = await em.findOne(Attachment, { id: attachmentId })
    if (!row) {
      logger.error('Attachment not found during OCR overflow fallback', { attachmentId })
      return
    }
    row.content = content
    await em.persist(row).flush()
    logger.info('OCR wait queue full; stored inline text extraction', {
      attachmentId,
      contentLength: content.length,
    })
  } catch (error) {
    logger.error('OCR wait queue overflow inline extraction failed', { attachmentId, err: error })
  } finally {
    await cleanup().catch((cleanupError) => {
      logger.warn('Temp file cleanup failed after OCR overflow fallback', { err: cleanupError })
    })
  }
}

export async function requestOcrProcessing(
  em: EntityManager,
  attachment: Attachment,
  driver: StorageDriver,
  storagePath: string,
): Promise<OcrProcessingDispatch> {
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

  const maxWaitQueue = resolveOcrMaxWaitQueue()
  if (ocrWaitQueue.length >= maxWaitQueue) {
    logger.warn('OCR wait queue full; falling back to inline text extraction', {
      attachmentId: attachment.id,
      waiting: ocrWaitQueue.length,
      maxWaitQueue,
    })
    await persistInlineTextExtractionFallback(workerEm, payload, driver)
    return 'inline_fallback'
  }

  setImmediate(() => {
    withOcrConcurrencySlot(() => processAttachmentOcr(workerEm, payload, driver)).catch((error) => {
      logger.error('Background processing error', { err: error })
    })
  })
  return 'queued'
}
