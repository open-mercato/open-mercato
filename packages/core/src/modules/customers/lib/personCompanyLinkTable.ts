import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from '@mikro-orm/postgresql'

const PERSON_COMPANY_LINKS_TABLE = 'customer_person_company_links'
const PERSON_COMPANY_LINKS_DELETED_AT_COLUMN = 'deleted_at'

let supportsDeletedAtColumnPromise: Promise<boolean> | null = null
let warnedAboutMissingDeletedAtColumn = false

export async function customerPersonCompanyLinksSupportDeletedAt(em: EntityManager): Promise<boolean> {
  if (typeof (em as { getKysely?: unknown }).getKysely !== 'function') {
    return true
  }
  if (supportsDeletedAtColumnPromise) return supportsDeletedAtColumnPromise
  const probe = (async (): Promise<boolean> => {
    try {
      const db = em.getKysely<any>() as any
      const row = await db
        .selectFrom('information_schema.columns')
        .select(['column_name'])
        .where(sql<boolean>`table_schema = current_schema()`)
        .where('table_name', '=', PERSON_COMPANY_LINKS_TABLE)
        .where('column_name', '=', PERSON_COMPANY_LINKS_DELETED_AT_COLUMN)
        .executeTakeFirst()
      return !!row
    } catch {
      // The probe can fail transiently (e.g. when invoked inside an already-aborted
      // postgres transaction — 25P02). Clear the cache so the next caller re-probes
      // on a healthy connection, and assume the column is present: the migration is
      // committed, and if it really is missing the downstream em.find will surface
      // the authentic "column does not exist" error instead of a misleading warning.
      supportsDeletedAtColumnPromise = null
      return true
    }
  })()
  supportsDeletedAtColumnPromise = probe
  return probe
}

export function warnMissingCustomerPersonCompanyLinksDeletedAt(source: string): void {
  if (warnedAboutMissingDeletedAtColumn) {
    return
  }
  warnedAboutMissingDeletedAtColumn = true
  console.warn(
    `[${source}] missing ${PERSON_COMPANY_LINKS_TABLE}.${PERSON_COMPANY_LINKS_DELETED_AT_COLUMN}; ` +
      'continuing without link soft-delete filtering. Run yarn db:migrate.',
  )
}

export async function withActiveCustomerPersonCompanyLinkFilter<T extends Record<string, unknown>>(
  em: EntityManager,
  where: T,
  source: string,
): Promise<T & { deletedAt?: null }> {
  const supportsDeletedAt = await customerPersonCompanyLinksSupportDeletedAt(em)
  if (!supportsDeletedAt) {
    warnMissingCustomerPersonCompanyLinksDeletedAt(source)
    return { ...where }
  }
  return { ...where, deletedAt: null }
}

/**
 * Drop soft-deleted link rows from a result set as a defense-in-depth fallback.
 * MikroORM has historically dropped `deletedAt: null` from the WHERE clause for
 * nullable date columns under certain configurations, so callers SHOULD apply this
 * after `findWithDecryption(...)` until the upstream query filter is verified to
 * fully cover all callers.
 */
export function filterActivePersonCompanyLinks<T extends { deletedAt?: Date | string | null | undefined }>(
  links: T[] | null | undefined,
): T[] {
  if (!Array.isArray(links)) return []
  return links.filter((entry) => entry?.deletedAt == null)
}
