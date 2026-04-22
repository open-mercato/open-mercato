import type { EntityManager } from '@mikro-orm/postgresql'

const PERSON_COMPANY_LINKS_TABLE = 'customer_person_company_links'
const PERSON_COMPANY_LINKS_DELETED_AT_COLUMN = 'deleted_at'

let supportsDeletedAtColumnPromise: Promise<boolean> | null = null
let warnedAboutMissingDeletedAtColumn = false

type KnexLike = (tableName: string) => {
  where: (filters: Record<string, unknown>) => {
    first: () => Promise<unknown>
  }
}

function getKnex(em: EntityManager): KnexLike {
  return (em.getConnection() as unknown as { getKnex: () => KnexLike }).getKnex()
}

export async function customerPersonCompanyLinksSupportDeletedAt(em: EntityManager): Promise<boolean> {
  if (typeof (em as { getConnection?: unknown }).getConnection !== 'function') {
    return true
  }
  if (!supportsDeletedAtColumnPromise) {
    supportsDeletedAtColumnPromise = getKnex(em)('information_schema.columns')
      .where({
        table_name: PERSON_COMPANY_LINKS_TABLE,
        column_name: PERSON_COMPANY_LINKS_DELETED_AT_COLUMN,
      })
      .first()
      .then((row) => !!row)
      .catch(() => false)
  }
  return supportsDeletedAtColumnPromise
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
