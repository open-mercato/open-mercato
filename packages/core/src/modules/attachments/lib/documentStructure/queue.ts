import { z } from 'zod'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { assertAttachmentScopeInvariant } from '../access'
import { documentOcrModeSchema } from './types'

export const DOCUMENT_STRUCTURE_QUEUE_NAME = 'attachments-document-structure'
export const DOCUMENT_STRUCTURE_WORKER_ID = 'attachments:document-structure'
export const DOCUMENT_STRUCTURE_QUEUE_DI_KEY = 'attachmentDocumentStructureQueue'

const DEFAULT_WORKER_CONCURRENCY = 2
const MAX_WORKER_CONCURRENCY = 20

export const documentStructureJobSchema = z.object({
  attachmentId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  force: z.boolean().optional(),
  onDemand: z.boolean().optional(),
  ocr: documentOcrModeSchema.optional(),
  requestedByUserId: z.string().uuid().nullable().optional(),
})
export type DocumentStructureJob = z.infer<typeof documentStructureJobSchema>

export const DOCUMENT_SECTION_SEARCH_JOB_KIND = 'section-search'
export const DOCUMENT_SECTION_SEARCH_MAX_IDS = 1000

export const documentSectionSearchJobSchema = z
  .object({
    kind: z.literal(DOCUMENT_SECTION_SEARCH_JOB_KIND),
    mode: z.enum(['index', 'delete']),
    tenantId: z.string().uuid().nullable(),
    organizationId: z.string().uuid().nullable(),
    extractionId: z.string().uuid().optional(),
    sectionIds: z.array(z.string().uuid()).min(1).max(DOCUMENT_SECTION_SEARCH_MAX_IDS).optional(),
    partitionCode: z.string().trim().min(1).max(120).optional(),
    afterOrdinal: z.number().int().min(-1).optional(),
    afterExtractionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((job, ctx) => {
    const targets = [job.extractionId, job.sectionIds, job.partitionCode].filter((value) => value !== undefined)
    if (targets.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: '[internal] Exactly one of extractionId, sectionIds or partitionCode is required',
      })
    }
    if (job.afterOrdinal !== undefined && job.extractionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['afterOrdinal'],
        message: '[internal] afterOrdinal requires extractionId',
      })
    }
    if (job.afterExtractionId !== undefined && job.partitionCode === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['afterExtractionId'],
        message: '[internal] afterExtractionId requires partitionCode',
      })
    }
    if (job.tenantId === null && job.organizationId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['organizationId'],
        message: '[internal] organizationId requires tenantId',
      })
    }
  })
export type DocumentSectionSearchJob = z.infer<typeof documentSectionSearchJobSchema>
export type DocumentSectionSearchMode = DocumentSectionSearchJob['mode']

export const documentStructureQueueJobSchema = z.union([documentSectionSearchJobSchema, documentStructureJobSchema])
export type DocumentStructureQueueJob = DocumentStructureJob | DocumentSectionSearchJob

export function isDocumentSectionSearchJob(payload: unknown): payload is { kind: typeof DOCUMENT_SECTION_SEARCH_JOB_KIND } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { kind?: unknown }).kind === DOCUMENT_SECTION_SEARCH_JOB_KIND
  )
}

export type EnqueueDocumentSectionSearchInput = Omit<DocumentSectionSearchJob, 'kind'>

export type EnqueueDocumentStructureInput = {
  attachmentId: string
  tenantId: string | null
  organizationId: string | null
  force?: boolean
  onDemand?: boolean
  ocr?: DocumentStructureJob['ocr']
  requestedByUserId?: string | null
}

export type DocumentStructureQueueContainer = {
  hasRegistration(name: string): boolean
  resolve<T>(name: string): T
}

export function resolveDocumentStructureWorkerConcurrency(): number {
  const raw = process.env.OM_ATTACHMENT_STRUCTURE_WORKER_CONCURRENCY
  if (raw === undefined || raw.trim() === '') return DEFAULT_WORKER_CONCURRENCY
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_WORKER_CONCURRENCY
  return Math.min(MAX_WORKER_CONCURRENCY, Math.floor(parsed))
}

let defaultQueue: Queue<DocumentStructureQueueJob> | null = null

function getDefaultDocumentStructureQueue(): Queue<DocumentStructureQueueJob> {
  if (!defaultQueue) {
    defaultQueue = createModuleQueue<DocumentStructureQueueJob>(DOCUMENT_STRUCTURE_QUEUE_NAME, {
      concurrency: resolveDocumentStructureWorkerConcurrency(),
    })
  }
  return defaultQueue
}

function resolveDocumentStructureQueue(
  container: DocumentStructureQueueContainer | null | undefined,
): Queue<DocumentStructureQueueJob> {
  if (container && container.hasRegistration(DOCUMENT_STRUCTURE_QUEUE_DI_KEY)) {
    return container.resolve<Queue<DocumentStructureQueueJob>>(DOCUMENT_STRUCTURE_QUEUE_DI_KEY)
  }
  return getDefaultDocumentStructureQueue()
}

export async function enqueueDocumentStructureExtraction(
  container: DocumentStructureQueueContainer | null | undefined,
  input: EnqueueDocumentStructureInput,
): Promise<string> {
  assertAttachmentScopeInvariant({ tenantId: input.tenantId, organizationId: input.organizationId })
  const payload = documentStructureJobSchema.parse({
    attachmentId: input.attachmentId,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    ...(input.force ? { force: true } : {}),
    ...(input.onDemand ? { onDemand: true } : {}),
    ...(input.ocr ? { ocr: input.ocr } : {}),
    ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {}),
  })
  return resolveDocumentStructureQueue(container).enqueue(payload)
}

export async function enqueueDocumentSectionSearch(
  container: DocumentStructureQueueContainer | null | undefined,
  input: EnqueueDocumentSectionSearchInput,
): Promise<string> {
  if (input.partitionCode === undefined) {
    assertAttachmentScopeInvariant({ tenantId: input.tenantId, organizationId: input.organizationId })
  }
  const payload = documentSectionSearchJobSchema.parse({
    kind: DOCUMENT_SECTION_SEARCH_JOB_KIND,
    mode: input.mode,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    ...(input.extractionId !== undefined ? { extractionId: input.extractionId } : {}),
    ...(input.sectionIds !== undefined ? { sectionIds: input.sectionIds } : {}),
    ...(input.partitionCode !== undefined ? { partitionCode: input.partitionCode } : {}),
    ...(input.afterOrdinal !== undefined ? { afterOrdinal: input.afterOrdinal } : {}),
    ...(input.afterExtractionId !== undefined ? { afterExtractionId: input.afterExtractionId } : {}),
  })
  return resolveDocumentStructureQueue(container).enqueue(payload)
}
