import type { EntityManager } from '@mikro-orm/postgresql'
import type { MutationGuard, MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { hasTier, loadScopedDocument, resolveLoadedDocumentUserAccess } from '../lib/permissions'

/**
 * Must match the `attachments` module's `E.attachments.attachment` entity id
 * (`attachments:attachment`). A literal, not an import, so this module never
 * imports from `attachments` — only the generic upload route declares the
 * registry target, and this guard matches it by value (#8891).
 */
const ATTACHMENT_ENTITY_ID = 'attachments:attachment'

function normalizeTargetId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The generic attachments upload route lets a caller pick the primary owner
 * and any number of secondary assignments, then merges both into one
 * normalized `assignments` array before this guard runs (see
 * `buildAttachmentOwnerAssignments` in `attachments/api/route.ts`) — so
 * scanning that single array also covers the primary owner.
 */
function collectProtectedDocumentIds(payload: MutationGuardInput['mutationPayload']): string[] {
  if (!payload) return []
  const ids = new Set<string>()
  const assignments = (payload as { assignments?: unknown }).assignments
  if (Array.isArray(assignments)) {
    for (const entry of assignments) {
      if (!entry || typeof entry !== 'object') continue
      const type = normalizeTargetId((entry as Record<string, unknown>).type)
      const id = normalizeTargetId((entry as Record<string, unknown>).id)
      if (type === DOCUMENTS_ENTITY_IDS.document && id) ids.add(id)
    }
  }
  return Array.from(ids)
}

/**
 * Deny a generic attachment upload whose primary owner or any secondary
 * assignment points at a document the caller cannot edit. Documents' own
 * dedicated upload route (`/api/documents/[id]/attachments`) is unaffected —
 * it writes through `attachmentService.createScoped`, a separate trusted
 * path that never reaches the generic HTTP route this guard targets.
 */
const attachmentOwnerAuthorizationGuard: MutationGuard = {
  id: 'documents.attachment-owner-authorization',
  targetEntity: ATTACHMENT_ENTITY_ID,
  operations: ['create'],
  priority: 10,

  async validate(input) {
    const documentIds = collectProtectedDocumentIds(input.mutationPayload)
    if (documentIds.length === 0) return { ok: true }
    if (!input.organizationId) {
      return { ok: false, status: 403, message: 'Forbidden' }
    }
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const container = await createRequestContainer()
    let em: EntityManager
    try {
      em = container.resolve('em') as EntityManager
    } catch {
      return { ok: false, status: 503, message: '[internal] Documents authorization is unavailable' }
    }
    for (const documentId of documentIds) {
      const document = await loadScopedDocument(em, documentId, scope)
      if (!document || document.archivedAt) {
        return { ok: false, status: 403, message: 'Forbidden' }
      }
      const tier = await resolveLoadedDocumentUserAccess(em, document, scope, input.userId, container)
      if (!hasTier(tier, 'editor')) {
        return { ok: false, status: 403, message: 'Forbidden' }
      }
    }
    return { ok: true }
  },
}

export const guards: MutationGuard[] = [attachmentOwnerAuthorizationGuard]
