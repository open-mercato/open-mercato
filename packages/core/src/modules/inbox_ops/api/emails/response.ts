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
  'isActive',
  'metadata',
  'organizationId',
  'tenantId',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const

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
): InboxEmail | Record<string, unknown> {
  if (includeContent) return email

  const redacted: Record<string, unknown> = { ...email }
  for (const field of EMAIL_CONTENT_FIELDS) {
    redacted[field] = null
  }
  return redacted
}
