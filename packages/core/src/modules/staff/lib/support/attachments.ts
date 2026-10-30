import type { ScopedAttachmentUploadErrorCode } from '@open-mercato/core/modules/attachments/lib/scoped-upload-service'

export const SUPPORT_TICKET_ATTACHMENT_ENTITY_ID = 'staff:staff_time_task'
export const CUSTOMER_VISIBLE_ATTACHMENT_TAG = 'customer-visible'
export const CUSTOMER_UPLOAD_TAG_PREFIX = 'customer-upload:'

export function customerUploadTag(customerUserId: string): string {
  return `${CUSTOMER_UPLOAD_TAG_PREFIX}${customerUserId}`
}

export function isCustomerVisibleAttachmentTags(tags: readonly string[] | null | undefined): boolean {
  return Array.isArray(tags) && tags.includes(CUSTOMER_VISIBLE_ATTACHMENT_TAG)
}

type ErrorTranslation = readonly [key: string, fallback: string]

/**
 * The scoped upload service reports failures as machine codes; the portal answers
 * with the attachments module's own translated message for the same condition, the
 * way `warranty_claims` does, so the client can show `error` verbatim.
 */
export const SUPPORT_UPLOAD_ERROR_TRANSLATIONS: Record<ScopedAttachmentUploadErrorCode, ErrorTranslation> = {
  dangerous_executable: ['attachments.errors.dangerousExecutable', 'Executable file types are not allowed as attachments.'],
  max_upload_size: ['attachments.errors.maxUploadSize', 'Attachment exceeds the maximum upload size.'],
  active_content: ['attachments.errors.activeContentBlocked', 'Active content uploads are not allowed.'],
  partition_unavailable: ['attachments.errors.partitionUnavailable', 'Attachment partition is not available for this scope.'],
  quota_exceeded: ['attachments.errors.quotaExceeded', 'Attachment storage quota exceeded for this tenant.'],
  quota_target_exists: ['attachments.errors.storagePathExists', 'The target storage path already exists.'],
  quota_unavailable: ['attachments.errors.quotaUnavailable', 'Storage quota accounting is unavailable.'],
  quota_recovery_unsupported: ['attachments.errors.quotaRecoveryUnsupported', 'Storage driver cannot participate in quota recovery.'],
  storage_failed: ['attachments.errors.storageFailed', 'Failed to store the attachment file.'],
  persistence_failed: ['attachments.errors.persistenceFailed', 'Failed to persist attachment.'],
}

const UPLOAD_FAILED_TRANSLATION: ErrorTranslation = ['attachments.errors.uploadFailed', 'Attachment upload failed.']

export function translateSupportUploadError(
  code: string,
  translate: (key: string, fallback: string) => string,
): string {
  const entry = (SUPPORT_UPLOAD_ERROR_TRANSLATIONS as Record<string, ErrorTranslation | undefined>)[code] ?? UPLOAD_FAILED_TRANSLATION
  return translate(entry[0], entry[1])
}
