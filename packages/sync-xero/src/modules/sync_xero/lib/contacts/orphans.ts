import type { XeroCompanyIndexSources } from './indexes'
import type { XeroRunIndex } from './preload'

export const XERO_ORPHAN_MIN_AGE_MS = 60_000

export type XeroOrphanedCompany = { entityId: string; marker: string; mappedEntityId: string | null }

/**
 * App Spec § 6.1 residual (2): a marked Company that its marker's Contact does not map to — the
 * Contact maps to another Company or to none — after a crash between a create and its claim, a lost
 * claim whose cleanup was refused or undone. Companies created within the last minute are skipped,
 * since a concurrent writer may be about to claim them. The report never deletes anything.
 */
export function findXeroOrphanedCompanies(sources: XeroCompanyIndexSources, runIndex: Pick<XeroRunIndex, 'lookup'>, now: Date): XeroOrphanedCompany[] {
  const createdAt = new Map(sources.companies.map((company) => [company.entityId, company.createdAt.getTime()]))
  const orphans: XeroOrphanedCompany[] = []
  for (const marker of sources.markers) {
    const created = createdAt.get(marker.entityId)
    if (created === undefined || now.getTime() - created < XERO_ORPHAN_MIN_AGE_MS) continue
    const mappedEntityId = runIndex.lookup(marker.value.trim())
    if (mappedEntityId !== marker.entityId) orphans.push({ entityId: marker.entityId, marker: marker.value.trim(), mappedEntityId })
  }
  return orphans
}
