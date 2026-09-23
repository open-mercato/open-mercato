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

import {
  TASK_ENTITY_TYPE_ALIAS_GROUPS,
  normalizeTaskEntityTypeSpelling,
} from '../task-entity-aliases'

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
 * The generated entity id behind each linkable record type. This is the only
 * mapping this file owns — the SPELLINGS come from `lib/task-entity-types.ts`,
 * which is the single alias dictionary, so a spelling added for the visibility
 * gate automatically resolves to a deep link too and the two cannot drift.
 */
const LINK_TARGET_BY_ENTITY_ID: Record<string, WorkInboxLinkedEntityType> = {
  'customers:customer_person_profile': CUSTOMER_PERSON,
  'customers:customer_company_profile': CUSTOMER_COMPANY,
  'customers:customer_deal': CUSTOMER_DEAL,
  'sales:sales_order': SALES_ORDER,
}

const ENTITY_TYPE_ALIASES: Record<string, WorkInboxLinkedEntityType> = Object.fromEntries(
  TASK_ENTITY_TYPE_ALIAS_GROUPS.flatMap((group) => {
    const target = LINK_TARGET_BY_ENTITY_ID[group.entityId]
    return target ? group.spellings.map((spelling) => [spelling, target] as const) : []
  }),
)

const ENTITY_DETAIL_PATHS: Record<WorkInboxLinkedEntityType, string> = {
  [CUSTOMER_PERSON]: '/backend/customers/people-v2',
  [CUSTOMER_COMPANY]: '/backend/customers/companies-v2',
  [CUSTOMER_DEAL]: '/backend/customers/deals',
  [SALES_ORDER]: '/backend/sales/orders',
}

/** `Customers.Person` / `customers.person` / `customers:person` → `customers:person`. */
export const normalizeEntityType = normalizeTaskEntityTypeSpelling

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
