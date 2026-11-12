import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'
import type { InboxEmailAttachmentListItem } from '../../data/validators'

/** Labels of the attachment ledger for the inbox_ops attachment islands; no client directive, it is imported by them. */

export type AttachmentStatus = InboxEmailAttachmentListItem['status']
export type AttachmentReason = NonNullable<InboxEmailAttachmentListItem['reason']>

export const ATTACHMENT_STATUS_VARIANTS: StatusMap<AttachmentStatus> = {
  stored: 'success',
  pending: 'info',
  skipped: 'warning',
  failed: 'error',
  released: 'neutral',
}

export function attachmentStatusLabels(t: TranslateFn): Record<AttachmentStatus, string> {
  return {
    stored: t('inbox_ops.attachments.status.stored', 'Stored'),
    pending: t('inbox_ops.attachments.status.pending', 'Pending'),
    skipped: t('inbox_ops.attachments.status.skipped', 'Skipped'),
    failed: t('inbox_ops.attachments.status.failed', 'Failed'),
    released: t('inbox_ops.attachments.status.released', 'Released'),
  }
}

export function attachmentReasonLabels(t: TranslateFn): Record<AttachmentReason, string> {
  return {
    inline_decoration: t('inbox_ops.attachments.reason.inline_decoration', 'Inline image in the email signature'),
    too_many: t('inbox_ops.attachments.reason.too_many', 'Too many attachments in this email'),
    too_large: t('inbox_ops.attachments.reason.too_large', 'The file is too large'),
    total_too_large: t('inbox_ops.attachments.reason.total_too_large', 'The attachments of this email are too large in total'),
    dangerous_executable: t('inbox_ops.attachments.reason.dangerous_executable', 'Executable files are not stored'),
    active_content: t('inbox_ops.attachments.reason.active_content', 'Files with active content are not stored'),
    unguarded_reader: t('inbox_ops.attachments.reason.unguarded_reader', 'Not stored: a module that reads attachments without access checks is enabled'),
    quota_exceeded: t('inbox_ops.attachments.reason.quota_exceeded', 'The attachment storage quota is exhausted'),
    partition_unavailable: t('inbox_ops.attachments.reason.partition_unavailable', 'The attachment storage is unavailable'),
    fetch_failed: t('inbox_ops.attachments.reason.fetch_failed', 'The file could not be downloaded from the email provider'),
    store_failed: t('inbox_ops.attachments.reason.store_failed', 'The file could not be stored'),
    processing_failed: t('inbox_ops.attachments.reason.processing_failed', 'The file could not be processed'),
    ingest_timeout: t('inbox_ops.attachments.reason.ingest_timeout', 'The file could not be fetched in time'),
  }
}

function formatSizeNumber(value: number, fractionDigits: number, locale: string | undefined): string {
  const options = { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
  try {
    return new Intl.NumberFormat(locale, options).format(value)
  } catch {
    // An unknown locale tag: the runtime's default locale still groups and separates digits.
    return new Intl.NumberFormat(undefined, options).format(value)
  }
}

/** A part size in B, KB or MB, its number formatted for `locale` (the active UI locale). */
export function formatAttachmentSize(t: TranslateFn, bytes: number | null, locale?: string): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null
  if (bytes < 1024) return t('inbox_ops.attachments.size.bytes', '{size} B', { size: formatSizeNumber(bytes, 0, locale) })
  if (bytes < 1024 * 1024) {
    return t('inbox_ops.attachments.size.kilobytes', '{size} KB', { size: formatSizeNumber(bytes / 1024, 1, locale) })
  }
  return t('inbox_ops.attachments.size.megabytes', '{size} MB', { size: formatSizeNumber(bytes / (1024 * 1024), 1, locale) })
}
