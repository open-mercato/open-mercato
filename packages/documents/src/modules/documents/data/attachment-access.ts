import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { AttachmentAccessInput, AttachmentAccessResolver, ProtectedAttachmentTarget } from '@open-mercato/core/modules/attachments'
import { resolveActorUserId } from '../lib/actor'
import { lockDocumentAggregateRoot } from '../commands/aggregate'
import { deriveDocumentCapabilities, type DocumentCapabilities } from '../lib/capabilities'
import { loadScopedDocument, resolveActiveSubjectRoleIds, resolvePermission } from '../lib/permissions'

const ownerIdSchema = z.string().uuid()
const resolverId = 'documents.document-attachments'

// Mutating actions ('create'/'reassign'/'delete') require edit capability
// below; only those are worth re-evaluating under the owner's own lock at
// the commit boundary. A read/render/metadata check never races a mutation
// it could invalidate, so it keeps the cheap unlocked read.
const EDIT_ACTIONS: ReadonlySet<AttachmentAccessInput['action']> = new Set(['create', 'reassign', 'delete'])

async function capabilitiesForDocument(input: AttachmentAccessInput, documentId: string): Promise<DocumentCapabilities | null> {
  const { subject, container, cache, signal, em, commitBoundary } = input
  const { tenantId, organizationId } = subject
  if (!tenantId || !organizationId || !ownerIdSchema.safeParse(documentId).success || signal.aborted) return null
  let actorUserId: string
  try {
    actorUserId = resolveActorUserId(subject.auth)
  } catch (error) {
    if (isCrudHttpError(error) && error.status === 403) return null
    throw error
  }
  const principalKey = JSON.stringify([subject.auth.sub, tenantId, organizationId])
  const cacheKey = JSON.stringify(['document', principalKey, documentId])
  const cached = cache.get(cacheKey) as Promise<DocumentCapabilities | null> | undefined
  if (cached) return cached
  const scope = { tenantId, organizationId }
  // Serialize the recheck against Documents' own aggregate-lock protocol
  // (archive/share mutations all take this same lock before writing) so a
  // revoke or archive racing the upload's commit cannot land after this
  // read — whichever side takes the lock first finishes first, and the
  // loser always observes the winner's committed result (#8975 review).
  const lockForMutation = commitBoundary === true && em !== undefined && EDIT_ACTIONS.has(input.action)
  const pending = (async () => {
    const docEm = lockForMutation ? em! : container.resolve<EntityManager>('em')
    const document = lockForMutation
      ? await lockDocumentAggregateRoot(docEm, documentId, scope).catch((error) => {
          if (isCrudHttpError(error) && error.status === 404) return null
          throw error
        })
      : await loadScopedDocument(docEm, documentId, scope)
    if (!document || signal.aborted) return null
    const roleKey = JSON.stringify(['roles', principalKey])
    let roles = cache.get(roleKey) as Promise<string[]> | undefined
    if (!roles) {
      roles = resolveActiveSubjectRoleIds(container, scope, subject.auth.sub)
      cache.set(roleKey, roles)
    }
    const projectedAuth = {
      ...subject.auth,
      userId: actorUserId,
      tenantId, orgId: organizationId, organizationId,
      resolvedRoleIds: await roles,
      features: [...subject.userFeatures],
      isSuperAdmin: subject.isSuperAdmin,
    }
    if (signal.aborted) return null
    // Reuse the same (now locked, when applicable) EntityManager so the
    // share lookup below is read inside the lock's transaction and reflects
    // whatever the lock serialized ahead of it.
    const relationshipTier = await resolvePermission(docEm, documentId, projectedAuth)
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
      const allowed = input.action === 'delete' || input.action === 'reassign' || input.action === 'create'
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
