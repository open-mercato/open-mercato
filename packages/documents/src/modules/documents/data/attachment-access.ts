import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AttachmentAccessInput, AttachmentAccessResolver, ProtectedAttachmentTarget } from '@open-mercato/core/modules/attachments'
import { resolveActorUserId } from '../lib/actor'
import { deriveDocumentCapabilities, type DocumentCapabilities } from '../lib/capabilities'
import { loadScopedDocument, resolveActiveSubjectRoleIds, resolvePermission } from '../lib/permissions'

const ownerIdSchema = z.string().uuid()
const resolverId = 'documents.document-attachments'

async function capabilitiesForDocument(input: AttachmentAccessInput, documentId: string): Promise<DocumentCapabilities | null> {
  const { subject, container, cache, signal } = input
  const { tenantId, organizationId } = subject
  if (!tenantId || !organizationId || !ownerIdSchema.safeParse(documentId).success || signal.aborted) return null
  const principalKey = JSON.stringify([subject.auth.sub, tenantId, organizationId])
  const cacheKey = JSON.stringify(['document', principalKey, documentId])
  const cached = cache.get(cacheKey) as Promise<DocumentCapabilities | null> | undefined
  if (cached) return cached
  const pending = (async () => {
    const em = container.resolve<EntityManager>('em')
    const document = await loadScopedDocument(em, documentId, { tenantId, organizationId })
    if (!document || signal.aborted) return null
    const roleKey = JSON.stringify(['roles', principalKey])
    let roles = cache.get(roleKey) as Promise<string[]> | undefined
    if (!roles) {
      roles = resolveActiveSubjectRoleIds(container, { tenantId, organizationId }, subject.auth.sub)
      cache.set(roleKey, roles)
    }
    const projectedAuth = {
      ...subject.auth,
      userId: resolveActorUserId(subject.auth),
      tenantId, orgId: organizationId, organizationId,
      resolvedRoleIds: await roles,
      features: [...subject.userFeatures],
      isSuperAdmin: subject.isSuperAdmin,
    }
    if (signal.aborted) return null
    const relationshipTier = await resolvePermission(em, documentId, projectedAuth)
    return deriveDocumentCapabilities({
      relationshipTier,
      managerOverride: subject.userFeatures.includes('documents.manage'),
      archived: document.archivedAt !== null && document.archivedAt !== undefined,
      userFeatures: subject.userFeatures,
    })
  })()
  cache.set(cacheKey, pending)
  return pending
}

export const attachmentAccessResolvers: AttachmentAccessResolver[] = [{
  id: resolverId,
  targetPartition: '*',
  targetEntity: 'documents:document',
  async resolve(input) {
    const targets = input.targets.filter((target) => target.entityId === 'documents:document')
    if (targets.some((target) => !ownerIdSchema.safeParse(target.recordId).success)) {
      return { ok: false, status: 404, reason: 'document_not_found' }
    }
    const requireEvery = input.action !== 'read' && input.action !== 'render'
    let visible = false
    for (const target of targets) {
      const capabilities = await capabilitiesForDocument(input, target.recordId)
      const allowed = input.action === 'delete' || input.action === 'reassign'
        ? capabilities?.canEdit === true
        : capabilities?.canView === true
      if (!allowed && requireEvery) return { ok: false, status: 404, reason: 'document_not_found' }
      if (allowed) visible = true
    }
    return visible ? { ok: true } : { ok: false, status: 404, reason: 'document_not_found' }
  },
}]

export const protectedAttachmentTargets: ProtectedAttachmentTarget[] = [{
  resolverId, targetPartition: '*', targetEntity: 'documents:document',
}]
