import type { EntityManager } from '@mikro-orm/postgresql'
import { AttachmentDocumentExtraction, AttachmentDocumentSection } from '../../data/entities'
import { assertAttachmentScopeInvariant } from '../access'

export type PurgeDocumentStructureInput = {
  attachmentId: string
  tenantId: string | null
  organizationId: string | null
}

export type PurgeDocumentStructureOptions = {
  /**
   * `false` runs the scoped deletes on the passed entity manager so they join the caller's
   * ambient transaction; otherwise both deletes commit together in their own transaction.
   */
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
  const deleteRows = async (target: EntityManager): Promise<PurgeDocumentStructureResult> => {
    const sectionCount = await target.nativeDelete(AttachmentDocumentSection, where)
    const extractionCount = await target.nativeDelete(AttachmentDocumentExtraction, where)
    return { extractionCount, sectionCount }
  }
  if (options.flush === false) return deleteRows(em)
  return em.transactional((tx) => deleteRows(tx))
}
