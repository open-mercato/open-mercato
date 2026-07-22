import {
  recomputeSubmissionCompletenessFromAttachmentPayload,
  type AttachmentSubscriberContext,
} from './recompute-completeness-on-attachment-created'

export const metadata = {
  event: 'attachments.attachment.deleted',
  persistent: false,
  id: 'eudr:attachment-deleted-completeness',
}

type AttachmentEventPayload = {
  entityId?: unknown
  recordId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

export default async function handleAttachmentDeleted(
  payload: AttachmentEventPayload,
  ctx: AttachmentSubscriberContext,
): Promise<void> {
  try {
    await recomputeSubmissionCompletenessFromAttachmentPayload(payload, ctx)
  } catch (error) {
    console.warn('[eudr] attachment-deleted completeness recompute failed', error)
  }
}
