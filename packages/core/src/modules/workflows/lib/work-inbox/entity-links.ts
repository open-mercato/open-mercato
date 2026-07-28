/**
 * Deep links from a task's entity bindings to the record they are about (PURE).
 *
 * A binding's `entityType` is AUTHORED free text — the inspector offers
 * `customers:person` as a placeholder but stores whatever the author typed —
 * so this is a tolerant lookup over an explicitly enumerated set, never a
 * guess. Anything not enumerated resolves to `null` and the panel renders the
 * binding as plain text: a wrong link is worse than no link.
 *
 * Separator spelling is normalized because the same record type is written two
 * ways across the platform: entity ids use `module:entity`
 * (`entities.ids.generated.ts`) while record-detail injection contexts use
 * `module.entity` (`resourceKind`). Both must resolve to the same target.
 */

const CUSTOMER_PERSON = 'customers:person'
const CUSTOMER_COMPANY = 'customers:company'
const CUSTOMER_DEAL = 'customers:deal'
const SALES_ORDER = 'sales:order'

export const WORK_INBOX_LINKED_ENTITY_TYPES = [
  CUSTOMER_PERSON,
  CUSTOMER_COMPANY,
  CUSTOMER_DEAL,
  SALES_ORDER,
] as const

export type WorkInboxLinkedEntityType = (typeof WORK_INBOX_LINKED_ENTITY_TYPES)[number]

/**
 * Alternate spellings that unambiguously mean one of the canonical types.
 * `customers:customer_entity` is deliberately absent — it backs both people and
 * companies, so it cannot pick a detail page.
 */
const ENTITY_TYPE_ALIASES: Record<string, WorkInboxLinkedEntityType> = {
  'customers:person': CUSTOMER_PERSON,
  'customers:people': CUSTOMER_PERSON,
  'customers:customer_person_profile': CUSTOMER_PERSON,
  'customers:company': CUSTOMER_COMPANY,
  'customers:companies': CUSTOMER_COMPANY,
  'customers:customer_company_profile': CUSTOMER_COMPANY,
  'customers:deal': CUSTOMER_DEAL,
  'customers:deals': CUSTOMER_DEAL,
  'customers:customer_deal': CUSTOMER_DEAL,
  'sales:order': SALES_ORDER,
  'sales:orders': SALES_ORDER,
  'sales:sales_order': SALES_ORDER,
  'sales:document': SALES_ORDER,
}

const ENTITY_DETAIL_PATHS: Record<WorkInboxLinkedEntityType, string> = {
  [CUSTOMER_PERSON]: '/backend/customers/people-v2',
  [CUSTOMER_COMPANY]: '/backend/customers/companies-v2',
  [CUSTOMER_DEAL]: '/backend/customers/deals',
  [SALES_ORDER]: '/backend/sales/orders',
}

/** `Customers.Person` / `customers.person` / `customers:person` → `customers:person`. */
export function normalizeEntityType(entityType: string): string {
  return entityType.trim().toLowerCase().replace(/\./g, ':')
}

export function resolveLinkedEntityType(entityType: string): WorkInboxLinkedEntityType | null {
  return ENTITY_TYPE_ALIASES[normalizeEntityType(entityType)] ?? null
}

/**
 * Backend detail href for a bound record, or `null` when the record type has no
 * enumerated detail page or the binding carries no id.
 */
export function buildEntityRecordHref(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): string | null {
  if (!entityType || !entityId) return null
  const canonical = resolveLinkedEntityType(entityType)
  if (!canonical) return null
  return `${ENTITY_DETAIL_PATHS[canonical]}/${encodeURIComponent(entityId)}`
}

/**
 * Every spelling of one record type, so a caller filtering the work inbox by
 * `entityType` matches bindings however their author spelled them.
 */
export function entityTypeQueryValues(entityType: string): string[] {
  const normalized = normalizeEntityType(entityType)
  const canonical = resolveLinkedEntityType(entityType)
  const values = new Set<string>([entityType, normalized, normalized.replace(/:/g, '.')])
  if (canonical) {
    for (const [alias, target] of Object.entries(ENTITY_TYPE_ALIASES)) {
      if (target !== canonical) continue
      values.add(alias)
      values.add(alias.replace(/:/g, '.'))
    }
  }
  return [...values].filter((value) => value.length > 0)
}
