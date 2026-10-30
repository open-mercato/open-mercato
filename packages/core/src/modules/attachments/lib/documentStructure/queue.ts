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

let defaultQueue: Queue<DocumentStructureJob> | null = null

function getDefaultDocumentStructureQueue(): Queue<DocumentStructureJob> {
  if (!defaultQueue) {
    defaultQueue = createModuleQueue<DocumentStructureJob>(DOCUMENT_STRUCTURE_QUEUE_NAME, {
      concurrency: resolveDocumentStructureWorkerConcurrency(),
    })
  }
  return defaultQueue
}

function resolveDocumentStructureQueue(
  container: DocumentStructureQueueContainer | null | undefined,
): Queue<DocumentStructureJob> {
  if (container && container.hasRegistration(DOCUMENT_STRUCTURE_QUEUE_DI_KEY)) {
    return container.resolve<Queue<DocumentStructureJob>>(DOCUMENT_STRUCTURE_QUEUE_DI_KEY)
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
