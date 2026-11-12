import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { InboxEmail } from '../../data/entities'
import type { RequestContext } from '../routeHelpers'

const EMAIL_CONTENT_FIELDS = [
  'messageId',
  'contentHash',
  'toAddress',
  'replyTo',
  'inReplyTo',
  'emailReferences',
  'rawText',
  'rawHtml',
  'cleanedText',
  'threadMessages',
  'detectedLanguage',
  'attachmentIds',
  'attachmentsStatus',
  'isActive',
  'metadata',
  'organizationId',
  'tenantId',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const satisfies readonly (keyof InboxEmail)[]

// Computed list fields that are email content too: `null` for callers without
// `inbox_ops.proposals.view`, like `EMAIL_CONTENT_FIELDS`.
export const EMAIL_LIST_CONTENT_FIELDS = ['attachmentsRetryable'] as const

// Attachment ingest, claim and release bookkeeping. Never serialized, whatever the
// caller's features: they are worker coordination state, not email data.
export const EMAIL_INTERNAL_FIELDS = [
  'attachmentsClaimToken',
  'attachmentsClaimedAt',
  'attachmentsFirstFailureAt',
  'attachmentsReleaseRequestedAt',
  'attachmentsReleasedAt',
  'attachmentsIngestGeneration',
  'attachmentsCurrentGeneration',
  'attachmentsNextRunAt',
] as const satisfies readonly (keyof InboxEmail)[]


export async function canViewEmailContent(ctx: RequestContext): Promise<boolean> {
  try {
    const rbac = ctx.container.resolve<RbacService>('rbacService')
    return await rbac.userHasAllFeatures(
      ctx.userId,
      ['inbox_ops.proposals.view'],
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
  } catch {
    return false
  }
}

export function serializeInboxEmail(
  email: InboxEmail,
  includeContent: boolean,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = { ...email }
  for (const field of EMAIL_INTERNAL_FIELDS) {
    delete serialized[field]
  }
  if (includeContent) return serialized

  for (const field of EMAIL_CONTENT_FIELDS) {
    serialized[field] = null
  }
  return serialized
}

/** A processing-log row: the email plus the computed `attachmentsRetryable`, redacted like the content. */
export function serializeInboxEmailListItem(
  email: InboxEmail,
  includeContent: boolean,
  computed: { attachmentsRetryable: boolean },
): Record<string, unknown> {
  const serialized = serializeInboxEmail(email, includeContent)
  serialized.attachmentsRetryable = computed.attachmentsRetryable
  if (!includeContent) {
    for (const field of EMAIL_LIST_CONTENT_FIELDS) serialized[field] = null
  }
  return serialized
}
