import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type AttachmentAssignmentPort = {
  type: string
  id: string
  href?: string | null
  label?: string | null
}

export interface AttachmentServicePort {
  validateUpload(input: {
    contentLength?: string | null
    fileName?: string
    fileSize?: number
  }): void
  readUploadForm?(request: Request): Promise<FormData>
  createScoped(input: {
    tenantId: string
    organizationId: string
    entityId: string
    recordId: string
    partitionCode: string
    fileName: string
    declaredMimeType?: string | null
    buffer: Buffer
    assignments?: AttachmentAssignmentPort[]
    persistLink?: (tx: EntityManager, attachmentId: string) => Promise<void> | void
  }): Promise<{ id: string }>
  readScoped(input: {
    attachmentId: string
    auth: NonNullable<AuthContext>
    expectedOwner: { entityId: string; recordId: string }
    expectedAssignment?: AttachmentAssignmentPort
    expectedPartitionCode?: string
    requirePrivatePartition?: boolean
    forceDownload?: boolean
  }): Promise<{
    buffer: Buffer
    contentType: string
    contentDisposition: string
  }>
  releaseScoped?(input: {
    attachmentId: string
    tenantId: string
    organizationId: string
    expectedOwner: { entityId: string; recordId: string }
    expectedAssignment: AttachmentAssignmentPort
    expectedPartitionCode?: string
  }, options?: { em?: EntityManager; flush?: boolean }): Promise<AttachmentProviderCleanupPort | void>
}

export type AttachmentProviderCleanupPort = () => Promise<void>

export function resolveAttachmentServicePort(container: {
  resolve: (name: string) => unknown
}): AttachmentServicePort {
  try {
    const candidate = container.resolve('attachmentService') as Partial<AttachmentServicePort> | null
    if (
      candidate &&
      typeof candidate.validateUpload === 'function' &&
      typeof candidate.createScoped === 'function' &&
      typeof candidate.readScoped === 'function'
    ) {
      return candidate as AttachmentServicePort
    }
  } catch {
    throw new CrudHttpError(503, { error: 'Attachment service is unavailable' })
  }
  throw new CrudHttpError(503, { error: 'Attachment service is unavailable' })
}

export async function readAttachmentUploadForm(
  service: AttachmentServicePort,
  request: Request,
): Promise<FormData> {
  if (typeof service.readUploadForm !== 'function') {
    throw new CrudHttpError(503, { error: 'Attachment service is unavailable' })
  }
  return service.readUploadForm(request)
}

export async function releaseScopedAttachment(
  service: AttachmentServicePort,
  input: Parameters<NonNullable<AttachmentServicePort['releaseScoped']>>[0],
  options?: Parameters<NonNullable<AttachmentServicePort['releaseScoped']>>[1],
): Promise<AttachmentProviderCleanupPort | void> {
  if (typeof service.releaseScoped !== 'function') {
    throw new CrudHttpError(503, { error: 'Attachment service is unavailable' })
  }
  return service.releaseScoped(input, options)
}
