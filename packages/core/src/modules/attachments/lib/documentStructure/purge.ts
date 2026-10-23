import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AttachmentDocumentExtraction, AttachmentDocumentSection } from '../../data/entities'
import { assertAttachmentScopeInvariant } from '../access'

export type PurgeDocumentStructureInput = {
  attachmentId: string
  tenantId: string | null
  organizationId: string | null
}

export type PurgeDocumentStructureOptions = {
  flush?: boolean
}

export type PurgeDocumentStructureResult = {
  extractionCount: number
  sectionCount: number
}

export async function purgeDocumentStructure(
  em: EntityManager,
  input: PurgeDocumentStructureInput,
  options: PurgeDocumentStructureOptions = {},
): Promise<PurgeDocumentStructureResult> {
  const scope = { tenantId: input.tenantId ?? null, organizationId: input.organizationId ?? null }
  assertAttachmentScopeInvariant(scope)
  const where = {
    attachmentId: input.attachmentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  const sections = await findWithDecryption(em, AttachmentDocumentSection, where, { fields: ['id'] }, scope)
  const extractions = await findWithDecryption(em, AttachmentDocumentExtraction, where, { fields: ['id'] }, scope)
  for (const section of sections) em.remove(section)
  for (const extraction of extractions) em.remove(extraction)
  if (options.flush !== false && (sections.length > 0 || extractions.length > 0)) {
    await em.flush()
  }
  return { extractionCount: extractions.length, sectionCount: sections.length }
}
