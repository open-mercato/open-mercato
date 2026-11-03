import type { ScopedAttachmentUploadService } from '@open-mercato/core/modules/attachments/lib/scoped-upload-service'

export function resolvePortalAttachmentUploadService(
  container: { resolve: <T = unknown>(name: string) => T },
): ScopedAttachmentUploadService | null {
  try {
    return container.resolve<ScopedAttachmentUploadService>('attachmentScopedUploadService') ?? null
  } catch {
    return null
  }
}
