import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { countTokens } from '@open-mercato/shared/lib/ai/token-count'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  Attachment,
  AttachmentDocumentExtraction,
  AttachmentDocumentSection,
  AttachmentPartition,
} from '../data/entities'
import { assertAttachmentScopeInvariant } from '../lib/access'
import type { StorageDriverFactory } from '../lib/drivers'
import {
  createDocumentStructureEngineRegistry,
  type DocumentStructureEngineRegistry,
} from '../lib/documentStructure/engines/registry'
import {
  applyOcrFallback,
  DocumentStructureOcrUnavailableError,
  resolveEffectiveOcrMode,
  type OcrStructureOptions,
} from '../lib/documentStructure/engines/ocr'
import { DocumentStructurePdfEncryptedError } from '../lib/documentStructure/engines/pdfLayout'
import {
  DocumentStructureFileTooLargeError,
  resolveMaxDocumentStructureBytes,
} from '../lib/documentStructure/engines/text'
import {
  DOCUMENT_STRUCTURE_QUEUE_NAME,
  DOCUMENT_STRUCTURE_WORKER_ID,
  documentStructureJobSchema,
  resolveDocumentStructureWorkerConcurrency,
  type DocumentStructureJob,
} from '../lib/documentStructure/queue'
import { structureDocument } from '../lib/documentStructure/structurer'
import type {
  DocumentStructureEngine,
  DocumentStructureEngineName,
  DocumentStructureExtractionResult,
  ExtractionSkipReason,
  ExtractionStatus,
} from '../lib/documentStructure/types'

export const metadata: WorkerMeta = {
  queue: DOCUMENT_STRUCTURE_QUEUE_NAME,
  id: DOCUMENT_STRUCTURE_WORKER_ID,
  concurrency: resolveDocumentStructureWorkerConcurrency(),
}

const DEFAULT_TIMEOUT_MS = 180_000
const REUSABLE_STATUSES: ReadonlySet<ExtractionStatus> = new Set(['completed', 'partial', 'skipped'])
const UNSUPPORTED_ENGINE: { id: DocumentStructureEngineName; version: number } = { id: 'mixed', version: 1 }
const PDF_ENGINE_ID: DocumentStructureEngineName = 'pdf_layout'

const logger = createLogger('attachments').child({ component: 'document-structure-worker' })

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

export type DocumentStructureWorkerDeps = {
  em: EntityManager
  storageDriverFactory: Pick<StorageDriverFactory, 'resolveForPartition'>
  registry?: Pick<DocumentStructureEngineRegistry, 'resolve'>
  ocrOptions?: OcrStructureOptions
  timeoutMs?: number
  maxBytes?: number
}

export type DocumentStructureRunOutcome =
  | { kind: 'not_found' }
  | { kind: 'disabled' }
  | { kind: 'reused'; extractionId: string }
  | { kind: 'aborted' }
  | { kind: 'persisted'; extractionId: string; status: ExtractionStatus }
  | { kind: 'failed_previous_kept'; extractionId: string; previousExtractionId: string }

type ExtractionDraft = {
  engine: DocumentStructureEngineName
  engineVersion: number
  status: ExtractionStatus
  skipReason: ExtractionSkipReason | null
  failureReason: string | null
  result: DocumentStructureExtractionResult | null
  stats: Record<string, unknown>
}

type ScopePair = { tenantId: string | null; organizationId: string | null }

class DocumentStructureTimeoutError extends Error {
  readonly code = 'timeout'

  constructor(timeoutMs: number) {
    super(`[internal] document structure extraction exceeded ${timeoutMs} ms`)
    this.name = 'DocumentStructureTimeoutError'
  }
}

export function resolveDocumentStructureTimeoutMs(): number {
  const raw = process.env.OM_ATTACHMENT_STRUCTURE_TIMEOUT_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TIMEOUT_MS
  return Math.floor(parsed)
}

export function sanitizeDocumentStructureFailure(error: unknown): string {
  if (error instanceof DocumentStructureTimeoutError) return '[internal] document structure extraction timed out'
  return '[internal] document structure extraction failed'
}

function resolveSkipReason(error: unknown): ExtractionSkipReason | null {
  if (error instanceof DocumentStructureFileTooLargeError) return 'too_large'
  if (error instanceof DocumentStructurePdfEncryptedError) return 'encrypted_pdf'
  if (error instanceof DocumentStructureOcrUnavailableError) return 'no_text_layer_ocr_disabled'
  return null
}

async function hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(filePath)) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    sizeBytes += buffer.length
    hash.update(buffer)
  }
  return { sha256: hash.digest('hex'), sizeBytes }
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DocumentStructureTimeoutError(timeoutMs)), timeoutMs)
  })
  work.catch(() => undefined)
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function fileExtension(fileName: string): string | null {
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase()
  return extension.length > 0 ? extension : null
}

function skippedDraft(
  engine: { id: DocumentStructureEngineName; version: number },
  skipReason: ExtractionSkipReason,
  stats: Record<string, unknown>,
): ExtractionDraft {
  return {
    engine: engine.id,
    engineVersion: engine.version,
    status: 'skipped',
    skipReason,
    failureReason: null,
    result: null,
    stats,
  }
}

async function runEngine(
  engine: DocumentStructureEngine,
  input: {
    filePath: string
    mimeType: string
    extension: string | null
    fileName: string
    ocrMode: ReturnType<typeof resolveEffectiveOcrMode>
    ocrModel: string | null
  },
  ocrOptions: OcrStructureOptions | undefined,
): Promise<ExtractionDraft> {
  const startedAt = Date.now()
  const engineResult = await engine.extract({
    filePath: input.filePath,
    mimeType: input.mimeType,
    extension: input.extension,
    ocr: input.ocrMode,
    ocrModel: input.ocrModel,
  })
  let finalResult = engineResult
  let engineName: DocumentStructureEngineName = engine.id
  let cappedPages: number[] = []
  let failedPages: number[] = []
  let ocrSkipped = false
  if (engine.id === PDF_ENGINE_ID) {
    const outcome = await applyOcrFallback(
      { filePath: input.filePath, result: engineResult, ocr: input.ocrMode, ocrModel: input.ocrModel },
      ocrOptions,
    )
    finalResult = outcome.result
    engineName = outcome.engine
    cappedPages = outcome.cappedPages
    failedPages = outcome.failedPages
    ocrSkipped = outcome.ocrSkipped
  }
  const pageCapReached =
    finalResult.pageCount !== null && finalResult.pageCharCounts.length < finalResult.pageCount
  const stats: Record<string, unknown> = {
    durationMs: Date.now() - startedAt,
    blockCount: finalResult.blocks.length,
    unreadablePageCount: finalResult.unreadablePages.length,
    ocrCappedPageCount: cappedPages.length,
    ocrFailedPageCount: failedPages.length,
    pageCapReached,
  }
  if (ocrSkipped && finalResult.blocks.length === 0) {
    return skippedDraft({ id: engineName, version: engine.version }, 'no_text_layer_ocr_disabled', stats)
  }
  const structured = structureDocument(finalResult, {
    engine: engineName,
    engineVersion: engine.version,
    title: input.fileName,
  })
  const partial = structured.status === 'partial' || pageCapReached || cappedPages.length > 0 || failedPages.length > 0
  return {
    engine: engineName,
    engineVersion: engine.version,
    status: partial ? 'partial' : 'completed',
    skipReason: null,
    failureReason: null,
    result: { ...structured, status: partial ? 'partial' : 'completed' },
    stats,
  }
}

function buildSectionRows(
  result: DocumentStructureExtractionResult,
  extractionId: string,
  attachmentId: string,
  scope: ScopePair,
) {
  const idsByOrdinal = new Map<number, string>()
  for (const section of result.sections) idsByOrdinal.set(section.ordinal, randomUUID())
  return result.sections.map((section) => ({
    id: idsByOrdinal.get(section.ordinal) ?? randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    extractionId,
    attachmentId,
    parentId: section.parentOrdinal === null ? null : idsByOrdinal.get(section.parentOrdinal) ?? null,
    ordinal: section.ordinal,
    depth: section.depth,
    kind: section.kind,
    numberLabel: section.numberLabel,
    heading: section.heading,
    headingPath: section.headingPath,
    text: section.text,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    charStart: section.charStart,
    charEnd: section.charEnd,
    anchorKey: section.anchorKey,
    textSha256: sha256Text(section.text),
    tokenEstimate: countTokens(section.text),
    source: section.source,
  }))
}

async function persistDraft(
  em: EntityManager,
  attachment: Attachment,
  draft: ExtractionDraft,
  contentSha256: string,
  requestedByUserId: string | null,
): Promise<DocumentStructureRunOutcome> {
  const scope: ScopePair = {
    tenantId: attachment.tenantId ?? null,
    organizationId: attachment.organizationId ?? null,
  }
  assertAttachmentScopeInvariant(scope)
  return em.transactional(async (tx) => {
    const stillExists = await findOneWithDecryption(
      tx,
      Attachment,
      { id: attachment.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      undefined,
      scope,
    )
    if (!stillExists) return { kind: 'aborted' } satisfies DocumentStructureRunOutcome
    const now = new Date()
    const liveFilter = {
      attachmentId: attachment.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }
    const previousGood =
      draft.status === 'failed'
        ? (await findWithDecryption(tx, AttachmentDocumentExtraction, liveFilter, undefined, scope)).find(
            (extraction) => REUSABLE_STATUSES.has(extraction.status),
          ) ?? null
        : null
    if (!previousGood) {
      await tx.nativeUpdate(AttachmentDocumentExtraction, liveFilter, { deletedAt: now, updatedAt: now })
    }
    const extractionId = randomUUID()
    const result = draft.result
    const extraction = tx.create(AttachmentDocumentExtraction, {
      id: extractionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      attachmentId: attachment.id,
      partitionCode: attachment.partitionCode,
      contentSha256,
      engine: draft.engine,
      engineVersion: draft.engineVersion,
      status: draft.status,
      skipReason: draft.skipReason,
      pageCount: result?.pageCount ?? null,
      sectionCount: result?.sectionCount ?? null,
      charCount: result?.charCount ?? null,
      ocrPageCount: result?.ocrPageCount ?? null,
      normalizedText: result?.normalizedText ?? null,
      failureReason: draft.failureReason,
      stats: draft.stats,
      requestedByUserId,
      completedAt: now,
      deletedAt: previousGood ? now : null,
    })
    const sections = result
      ? buildSectionRows(result, extractionId, attachment.id, scope).map((row) =>
          tx.create(AttachmentDocumentSection, row),
        )
      : []
    tx.persist(extraction)
    for (const section of sections) tx.persist(section)
    await tx.flush()
    if (previousGood) {
      return {
        kind: 'failed_previous_kept',
        extractionId,
        previousExtractionId: previousGood.id,
      } satisfies DocumentStructureRunOutcome
    }
    return { kind: 'persisted', extractionId, status: draft.status } satisfies DocumentStructureRunOutcome
  })
}

export async function runDocumentStructureExtraction(
  rawPayload: DocumentStructureJob,
  deps: DocumentStructureWorkerDeps,
): Promise<DocumentStructureRunOutcome> {
  const payload = documentStructureJobSchema.parse(rawPayload)
  const scope: ScopePair = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  assertAttachmentScopeInvariant(scope)
  const { em } = deps
  const attachment = await findOneWithDecryption(
    em,
    Attachment,
    { id: payload.attachmentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (!attachment) {
    logger.info('Attachment not found for structure extraction', { attachmentId: payload.attachmentId })
    return { kind: 'not_found' }
  }
  const partition = await findOneWithDecryption(
    em,
    AttachmentPartition,
    { code: attachment.partitionCode },
    undefined,
    scope,
  )
  if (!partition || !partition.extractDocumentStructure) return { kind: 'disabled' }

  const registry = deps.registry ?? createDocumentStructureEngineRegistry()
  const extension = fileExtension(attachment.fileName)
  const engine = registry.resolve(attachment.mimeType, extension)
  const engineIdentity = engine ? { id: engine.id, version: engine.version } : UNSUPPORTED_ENGINE
  const requestedByUserId = payload.requestedByUserId ?? null

  const driverScope =
    scope.tenantId && scope.organizationId
      ? { tenantId: scope.tenantId, organizationId: scope.organizationId }
      : undefined
  const driver = await deps.storageDriverFactory.resolveForPartition(attachment.partitionCode, driverScope)
  const { filePath, cleanup } = await driver.toLocalPath(attachment.partitionCode, attachment.storagePath)
  try {
    const { sha256: contentSha256, sizeBytes } = await hashFile(filePath)
    if (!payload.force) {
      const liveExtractions = await findWithDecryption(
        em,
        AttachmentDocumentExtraction,
        {
          attachmentId: attachment.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      const current = liveExtractions.find(
        (extraction) =>
          extraction.contentSha256 === contentSha256 &&
          extraction.engineVersion === engineIdentity.version &&
          REUSABLE_STATUSES.has(extraction.status),
      )
      if (current) return { kind: 'reused', extractionId: current.id }
    }

    let draft: ExtractionDraft
    const maxBytes = deps.maxBytes ?? resolveMaxDocumentStructureBytes()
    if (!engine) {
      draft = skippedDraft(engineIdentity, 'unsupported_type', { sizeBytes })
    } else if (sizeBytes > maxBytes) {
      draft = skippedDraft(engineIdentity, 'too_large', { sizeBytes })
    } else {
      const ocrMode = resolveEffectiveOcrMode(payload.ocr, partition.requiresOcr)
      try {
        draft = await withTimeout(
          runEngine(
            engine,
            {
              filePath,
              mimeType: attachment.mimeType,
              extension,
              fileName: attachment.fileName,
              ocrMode,
              ocrModel: partition.ocrModel ?? null,
            },
            deps.ocrOptions,
          ),
          deps.timeoutMs ?? resolveDocumentStructureTimeoutMs(),
        )
      } catch (error) {
        const skipReason = resolveSkipReason(error)
        if (skipReason) {
          draft = skippedDraft(engineIdentity, skipReason, { sizeBytes })
        } else {
          logger.error('Document structure extraction failed', { attachmentId: attachment.id, err: error })
          getTelemetryRuntime()?.reportError(error, {
            module: 'attachments',
            code: 'attachments.document_structure_failed',
          })
          draft = {
            engine: engineIdentity.id,
            engineVersion: engineIdentity.version,
            status: 'failed',
            skipReason: null,
            failureReason: sanitizeDocumentStructureFailure(error),
            result: null,
            stats: { sizeBytes },
          }
        }
      }
    }

    const outcome = await persistDraft(em, attachment, draft, contentSha256, requestedByUserId)
    if (outcome.kind === 'persisted') {
      logger.info('Document structure extraction stored', {
        attachmentId: attachment.id,
        extractionId: outcome.extractionId,
        status: outcome.status,
        engine: draft.engine,
      })
    } else if (outcome.kind === 'failed_previous_kept') {
      logger.warn('Document structure re-extraction failed; previous extraction kept live', {
        attachmentId: attachment.id,
        extractionId: outcome.extractionId,
        previousExtractionId: outcome.previousExtractionId,
      })
    } else {
      logger.info('Attachment removed during structure extraction', { attachmentId: attachment.id })
    }
    return outcome
  } finally {
    await cleanup().catch((cleanupError) => {
      logger.warn('Temp file cleanup failed', { err: cleanupError })
    })
  }
}

function resolveOptional<T>(ctx: HandlerContext, name: string): T | undefined {
  try {
    return ctx.resolve<T>(name)
  } catch {
    return undefined
  }
}

export default async function handle(
  job: QueuedJob<DocumentStructureJob>,
  ctx: HandlerContext,
): Promise<void> {
  await runDocumentStructureExtraction(job.payload, {
    em: ctx.resolve<EntityManager>('em'),
    storageDriverFactory: ctx.resolve<StorageDriverFactory>('storageDriverFactory'),
    registry: resolveOptional<DocumentStructureEngineRegistry>(ctx, 'documentStructureEngineRegistry'),
  })
}
