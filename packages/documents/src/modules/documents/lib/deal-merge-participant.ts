import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  registerEntityMergeParticipant,
  type EntityMergeParticipantInput,
  type EntityMergeParticipantPreview,
  type EntityMergeParticipantResult,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { DocumentEntityLink } from '../data/entities'
import { DEAL_REFERENCE_ENTITY_ID } from './dealReferenceGuard'
import { nextDocumentVersion } from './versioning'

const PARTICIPANT_ID = 'documents.deal-links'
export const DOCUMENT_DEAL_MERGE_PARTICIPANT_LABEL = 'documents.dealMerge.participantLabel'
export const DOCUMENT_DEAL_MERGE_PREVIEW_FEATURES: readonly string[] = ['documents.view']

async function loadLinks(input: EntityMergeParticipantInput, includeDeleted: boolean) {
  return findWithDecryption(
    input.em,
    DocumentEntityLink,
    {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(includeDeleted ? {} : { deletedAt: null }),
      dealId: { $in: [input.survivorId, input.sourceId] },
    },
    { disableIdentityMap: true, ...(includeDeleted ? { filters: false } : {}) },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

export async function previewDocumentDealLinks(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantPreview> {
  const links = await loadLinks(input, false)
  const survivorDocuments = new Set(
    links.filter((link) => link.dealId === input.survivorId).map((link) => link.documentId),
  )
  const sourceDocuments = new Set(
    links.filter((link) => link.dealId === input.sourceId).map((link) => link.documentId),
  )
  let overlapCount = 0
  for (const documentId of sourceDocuments) if (survivorDocuments.has(documentId)) overlapCount += 1
  return {
    participantId: PARTICIPANT_ID,
    label: DOCUMENT_DEAL_MERGE_PARTICIPANT_LABEL,
    sourceCount: sourceDocuments.size,
    survivorCount: survivorDocuments.size,
    overlapCount,
  }
}

export async function mergeDocumentDealLinks(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantResult> {
  const links = await loadLinks(input, true)
  const survivorLinks = links.filter((link) => link.dealId === input.survivorId)
  const survivorActiveDocuments = new Set(
    survivorLinks.filter((link) => !link.deletedAt).map((link) => link.documentId),
  )
  const survivorAnyDocuments = new Set(survivorLinks.map((link) => link.documentId))
  const sourceLinks = links
    .filter((link) => link.dealId === input.sourceId)
    .sort((left, right) => Number(Boolean(left.deletedAt)) - Number(Boolean(right.deletedAt)))
  let moved = 0
  let deduplicated = 0
  for (const link of sourceLinks) {
    const active = !link.deletedAt
    const occupied = active
      ? survivorActiveDocuments.has(link.documentId)
      : survivorAnyDocuments.has(link.documentId)
    if (occupied) {
      await input.em.nativeDelete(DocumentEntityLink, {
        id: link.id,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      deduplicated += 1
      continue
    }
    await input.em.nativeUpdate(DocumentEntityLink, {
      id: link.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      dealId: input.sourceId,
    }, { dealId: input.survivorId, updatedAt: nextDocumentVersion(link.updatedAt) })
    if (active) survivorActiveDocuments.add(link.documentId)
    survivorAnyDocuments.add(link.documentId)
    moved += 1
  }
  return { moved, deduplicated }
}

export function registerDocumentDealMergeParticipant(): () => void {
  return registerEntityMergeParticipant({
    id: PARTICIPANT_ID,
    entityId: DEAL_REFERENCE_ENTITY_ID,
    previewFeatures: DOCUMENT_DEAL_MERGE_PREVIEW_FEATURES,
    preview: previewDocumentDealLinks,
    merge: mergeDocumentDealLinks,
  })
}
