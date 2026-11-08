import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import type {
  AttachmentAccessInput,
  AttachmentAccessResolver,
  ProtectedAttachmentTarget,
} from '@open-mercato/core/modules/attachments'
import { InboxEmail } from './entities'

const resolverId = 'inbox_ops.email-attachments'
const ownerEntityId = 'inbox_ops:inbox_email'
// Reading an inbound attachment follows reading the email it came with (spec D3, D18).
const readFeature = 'inbox_ops.proposals.view'

const notFound = { ok: false, status: 404, reason: 'inbox_email_not_found' } as const

/**
 * Ids of the scope's soft-deleted emails whose attachments are not released yet. Loaded once
 * per tenant and organization per request (a super-admin scan can cover several scopes) and
 * served by `inbox_emails_attachments_release_pending_idx`. Emails deleted before attachment
 * ingestion existed have neither `attachments_status` nor `attachments_release_requested_at`
 * and are never in the set.
 */
function loadReleasePendingEmailIds(
  input: AttachmentAccessInput,
  tenantId: string,
  organizationId: string,
): Promise<ReadonlySet<string>> {
  const cacheKey = JSON.stringify(['release-pending-emails', tenantId, organizationId])
  const cached = input.cache.get(cacheKey) as Promise<ReadonlySet<string>> | undefined
  if (cached) return cached
  const pending = (async () => {
    const em = input.container.resolve<EntityManager>('em')
    const rows = await findWithDecryption(
      em,
      InboxEmail,
      {
        tenantId,
        organizationId,
        deletedAt: { $ne: null },
        attachmentsReleasedAt: null,
        $or: [
          { attachmentsStatus: { $ne: null } },
          { attachmentsReleaseRequestedAt: { $ne: null } },
        ],
      },
      { fields: ['id'], disableIdentityMap: true },
      { tenantId, organizationId },
    )
    return new Set(rows.map((row) => row.id.toLowerCase())) as ReadonlySet<string>
  })()
  input.cache.set(cacheKey, pending)
  return pending
}

export const attachmentAccessResolvers: AttachmentAccessResolver[] = [{
  id: resolverId,
  targetPartition: '*',
  targetEntity: ownerEntityId,
  async resolve(input) {
    // The shared policy entrypoint honors wildcards, removed features and disabled modules.
    // Checked before the managed-action refusal, so a caller who may not read inbox mail cannot
    // tell an inbox attachment id (403) from an unknown one (404).
    const canRead = authorizeFeatures([readFeature], {
      grantedFeatures: input.subject.userFeatures,
      unrestricted: input.subject.isSuperAdmin,
    })
    if (!canRead) return notFound
    // Only `inbox_ops` manages these files: deleting the email releases them (spec D11).
    if (input.action === 'reassign' || input.action === 'delete') {
      return { ok: false, status: 403, reason: 'inbox_email_attachment_managed_by_inbox' }
    }
    const emailIds = input.targets
      .filter((target) => target.entityId === ownerEntityId)
      .map((target) => target.recordId.toLowerCase())
    if (!emailIds.length) return { ok: true }
    const { tenantId, organizationId } = input.attachment
    // Inbound files are always tenant- and organization-scoped; a global row claiming an
    // email owner was planted and cannot be matched against a scope, so it stays hidden.
    if (!tenantId || !organizationId) return notFound
    const releasePending = await loadReleasePendingEmailIds(input, tenantId, organizationId)
    return emailIds.some((emailId) => releasePending.has(emailId)) ? notFound : { ok: true }
  },
}]

export const protectedAttachmentTargets: ProtectedAttachmentTarget[] = [{
  resolverId,
  targetPartition: '*',
  targetEntity: ownerEntityId,
  listInLibrary: false,
}]
