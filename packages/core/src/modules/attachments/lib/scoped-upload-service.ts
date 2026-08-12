import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment, AttachmentPartition } from '../data/entities'
import { attachmentCrudEvents, attachmentCrudIndexer } from './crud'
import type { StorageDriverFactory } from './drivers'
import { buildAttachmentFileUrl } from './imageUrls'
import { ensureDefaultPartitions, resolveDefaultPartitionCode } from './partitions'
import { extractAttachmentContent } from './textExtraction'
import { requestOcrProcessing } from './ocrQueue'
import { OcrService, shouldUseLlmOcr } from './ocrService'
import { assertAttachmentScopeInvariant } from './access'
import {
  mergeAttachmentMetadata,
  upsertAssignment,
  type AttachmentAssignment,
} from './metadata'
import {
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
  sanitizeUploadedFileName,
} from './security'
import { resolveAttachmentMaxBytes } from './upload-limits'
import type { AttachmentQuotaService } from './quota-service'

const logger = createLogger('attachments')

export type ScopedAttachmentUploadErrorCode =
  | 'dangerous_executable'
  | 'max_upload_size'
  | 'active_content'
  | 'partition_unavailable'
  | 'quota_exceeded'
  | 'quota_target_exists'
  | 'quota_unavailable'
  | 'quota_recovery_unsupported'
  | 'storage_failed'
  | 'persistence_failed'

export class ScopedAttachmentUploadError extends Error {
  constructor(
    public readonly code: ScopedAttachmentUploadErrorCode,
    public readonly status: number,
  ) {
    super(code)
    this.name = 'ScopedAttachmentUploadError'
  }
}

export type ScopedAttachmentUploadInput = {
  tenantId: string
  organizationId: string
  entityId: string
  recordId: string
  fileName: string
  declaredMimeType?: string | null
  buffer: Buffer
  tags?: string[]
  assignments?: AttachmentAssignment[]
  partitionCode?: string | null
  maxBytes?: number
}

type QuotaRecoveryScheduler = (
  payload: { reservationId: string; tenantId: string; organizationId: string },
  delayMs: number,
) => Promise<void>

export class ScopedAttachmentUploadService {
  constructor(private readonly deps: {
    em: EntityManager
    dataEngine?: DataEngine | null
    storageDriverFactory: StorageDriverFactory
    attachmentQuotaService: AttachmentQuotaService
    attachmentQuotaRecoveryScheduler: QuotaRecoveryScheduler
  }) {}

  async upload(input: ScopedAttachmentUploadInput): Promise<Attachment> {
    const safeName = sanitizeUploadedFileName(input.fileName)
    if (hasDangerousExecutableExtension(safeName)) {
      throw new ScopedAttachmentUploadError('dangerous_executable', 400)
    }
    if (input.buffer.length > (input.maxBytes ?? resolveAttachmentMaxBytes())) {
      throw new ScopedAttachmentUploadError('max_upload_size', 413)
    }
    const mimeType = detectAttachmentMimeType(input.buffer, safeName, input.declaredMimeType ?? '')
    if (isActiveContentAttachment(input.buffer, safeName, mimeType)) {
      throw new ScopedAttachmentUploadError('active_content', 400)
    }

    const { em, storageDriverFactory, attachmentQuotaService, attachmentQuotaRecoveryScheduler } = this.deps
    await ensureDefaultPartitions(em)
    const partitionCode = input.partitionCode ?? resolveDefaultPartitionCode(input.entityId)
    const partition = await em.findOne(AttachmentPartition, { code: partitionCode })
    if (!partition) throw new ScopedAttachmentUploadError('partition_unavailable', 400)

    const driver = await storageDriverFactory.resolveForPartition(partition.code, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    const preparedStoragePath = driver.prepareStoragePath?.({
      partitionCode: partition.code,
      orgId: input.organizationId,
      tenantId: input.tenantId,
      fileName: safeName,
    })
    if (!preparedStoragePath) {
      throw new ScopedAttachmentUploadError('quota_recovery_unsupported', 500)
    }

    let reservation: { id: string; leaseToken: string; expiresAt: Date } | null = null
    try {
      reservation = await attachmentQuotaService.reserve({
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        bytes: input.buffer.length,
        source: 'attachment',
        storageDriver: driver.key,
        storagePath: preparedStoragePath,
        partitionCode: partition.code,
      })
      await attachmentQuotaRecoveryScheduler({
        reservationId: reservation.id,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }, Math.max(1_000, reservation.expiresAt.getTime() - Date.now()))
      await attachmentQuotaService.beginStorage(reservation.id, reservation.leaseToken)
    } catch (error) {
      if (reservation) {
        await attachmentQuotaService.release(reservation.id, reservation.leaseToken).catch(() => undefined)
      }
      const code = (error as { code?: unknown })?.code
      if (code === 'quota_exceeded') throw new ScopedAttachmentUploadError('quota_exceeded', 413)
      if (code === 'quota_target_exists') throw new ScopedAttachmentUploadError('quota_target_exists', 409)
      throw new ScopedAttachmentUploadError('quota_unavailable', 500)
    }

    if (!reservation) throw new ScopedAttachmentUploadError('quota_unavailable', 500)

    let storedPath = preparedStoragePath
    try {
      const stored = await driver.store({
        partitionCode: partition.code,
        orgId: input.organizationId,
        tenantId: input.tenantId,
        fileName: safeName,
        buffer: input.buffer,
        storagePath: preparedStoragePath,
      })
      storedPath = stored.storagePath
      await attachmentQuotaService.markStored(reservation.id, reservation.leaseToken)
    } catch (error) {
      await this.compensateStorage(driver, partition.code, storedPath, reservation)
      logger.error('Scoped attachment storage failed', { err: error })
      throw new ScopedAttachmentUploadError('storage_failed', 500)
    }

    let extractedContent: string | null = null
    const wantsLlmOcr = partition.requiresOcr && shouldUseLlmOcr(mimeType, safeName)
    const ocrService = wantsLlmOcr ? new OcrService() : null
    const useLlmOcr = Boolean(wantsLlmOcr && ocrService?.available)
    if (partition.requiresOcr && !useLlmOcr) {
      try {
        const { filePath, cleanup } = await driver.toLocalPath(partition.code, storedPath)
        try {
          extractedContent = await extractAttachmentContent({ filePath, mimeType })
        } finally {
          await cleanup().catch(() => undefined)
        }
      } catch (error) {
        logger.error('Scoped attachment text extraction failed', { err: error })
      }
    }

    let assignments = input.assignments?.slice() ?? []
    assignments = upsertAssignment(assignments, { type: input.entityId, id: input.recordId })
    const metadata = mergeAttachmentMetadata(null, {
      assignments,
      tags: input.tags ?? [],
    })
    const attachmentId = randomUUID()
    let attachment!: Attachment

    try {
      await em.transactional(async (tx) => {
        attachment = tx.create(Attachment, {
          id: attachmentId,
          entityId: input.entityId,
          recordId: input.recordId,
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          fileName: safeName,
          mimeType,
          fileSize: input.buffer.length,
          partitionCode: partition.code,
          storageDriver: partition.storageDriver || 'local',
          storagePath: storedPath,
          url: buildAttachmentFileUrl(attachmentId),
          content: extractedContent,
          storageMetadata: metadata,
        })
        assertAttachmentScopeInvariant({ tenantId: attachment.tenantId, organizationId: attachment.organizationId })
        await tx.persist(attachment).flush()
        await attachmentQuotaService.completeAttachment(reservation.id, reservation.leaseToken, tx)
      })
    } catch (error) {
      await this.compensateStorage(driver, partition.code, storedPath, reservation)
      logger.error('Scoped attachment persistence failed', { err: error })
      throw new ScopedAttachmentUploadError('persistence_failed', 500)
    }

    if (useLlmOcr) {
      requestOcrProcessing(em, attachment, driver, storedPath).catch((error) => {
        logger.error('Scoped attachment OCR scheduling failed', { err: error })
      })
    }
    if (this.deps.dataEngine) {
      await emitCrudSideEffects({
        dataEngine: this.deps.dataEngine,
        action: 'created',
        entity: attachment,
        identifiers: {
          id: attachment.id,
          organizationId: attachment.organizationId ?? null,
          tenantId: attachment.tenantId ?? null,
        },
        events: attachmentCrudEvents,
        indexer: attachmentCrudIndexer,
      })
      await this.deps.dataEngine.flushOrmEntityChanges()
    }
    return attachment
  }

  private async compensateStorage(
    driver: Awaited<ReturnType<StorageDriverFactory['resolveForPartition']>>,
    partitionCode: string,
    storagePath: string,
    reservation: { id: string; leaseToken: string },
  ): Promise<void> {
    try {
      await (driver.deleteStrict?.(partitionCode, storagePath) ?? driver.delete(partitionCode, storagePath))
      await this.deps.attachmentQuotaService.release(reservation.id, reservation.leaseToken)
    } catch (error) {
      logger.error('Scoped attachment compensation failed', { err: error })
    }
  }
}
