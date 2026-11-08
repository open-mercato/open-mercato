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
const managedByInbox = { ok: false, status: 403, reason: 'inbox_email_attachment_managed_by_inbox' } as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function releasePendingCacheKey(tenantId: string, organizationId: string, emailId: string): string {
  return JSON.stringify(['release-pending-email', tenantId, organizationId, emailId])
}

/**
 * Whether any of `emailIds` (lower-cased) is a soft-deleted email of the scope whose attachments
 * are not released yet. The lookup reads only the requested ids (`id in (…)`), so its cost is
 * bounded by the targets of the check, never by the scope's deletion backlog, and each answer is
 * cached per tenant, organization and id for the request (a super-admin scan can cover several
 * scopes; a list repeats owners). Ids that are not UUIDs cannot name an inbox email and are not
 * looked up. Emails deleted before attachment ingestion existed have neither `attachments_status`
 * nor `attachments_release_requested_at` and are never denied.
 */
async function isAnyReleasePending(
  input: AttachmentAccessInput,
  tenantId: string,
  organizationId: string,
  emailIds: string[],
): Promise<boolean> {
  const answers: Array<Promise<boolean>> = []
  const missing: string[] = []
  for (const emailId of new Set(emailIds.filter((id) => UUID_PATTERN.test(id)))) {
    const cached = input.cache.get(releasePendingCacheKey(tenantId, organizationId, emailId)) as Promise<boolean> | undefined
    if (cached) answers.push(cached)
    else missing.push(emailId)
  }
  if (missing.length) {
    const lookup = (async () => {
      const em = input.container.resolve<EntityManager>('em')
      const rows = await findWithDecryption(
        em,
        InboxEmail,
        {
          id: { $in: missing },
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
      return new Set(rows.map((row) => row.id.toLowerCase()))
    })()
    for (const emailId of missing) {
      const answer = lookup.then((pending) => pending.has(emailId))
      input.cache.set(releasePendingCacheKey(tenantId, organizationId, emailId), answer)
      answers.push(answer)
    }
  }
  return (await Promise.all(answers)).some(Boolean)
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
    const managed = input.action === 'reassign' || input.action === 'delete'
    const emailIds = input.targets
      .filter((target) => target.entityId === ownerEntityId)
      .map((target) => target.recordId.toLowerCase())
    if (!emailIds.length) return managed ? managedByInbox : { ok: true }
    const { tenantId, organizationId } = input.attachment
    // Inbound files are always tenant- and organization-scoped; a global row claiming an
    // email owner was planted and cannot be matched against a scope, so it stays hidden.
    if (!tenantId || !organizationId) return notFound
    // A deleted email's files are gone for every action until the release removes them, so the
    // deny set is checked before the managed-action refusal: 404, not 403.
    if (await isAnyReleasePending(input, tenantId, organizationId, emailIds)) return notFound
    return managed ? managedByInbox : { ok: true }
  },
}]

export const protectedAttachmentTargets: ProtectedAttachmentTarget[] = [{
  resolverId,
  targetPartition: '*',
  targetEntity: ownerEntityId,
  listInLibrary: false,
}]
