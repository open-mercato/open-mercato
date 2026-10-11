/**
 * The ONE alias dictionary for authored task `entityType` values (PURE — zero
 * imports, safe in a client bundle).
 *
 * A binding's `entityType` is free text: the inspector offers `customers:person`
 * as a placeholder and stores whatever the author typed, while the ACL
 * requirement table and the entity registry are keyed on the GENERATED id
 * (`customers:customer_person_profile`). Two consumers need the same spellings —
 * `task-entity-types.ts` resolves them to an entity id for the visibility gate,
 * `work-inbox/entity-links.ts` resolves them to a record deep link — and they
 * read this table rather than each keeping a copy. The repo already carries
 * divergent alias tables in `customers/ai-agents-context.ts` and the
 * optimistic-lock `resourceKind` readers; a fourth one is not acceptable.
 *
 * It lives in its own module, with nothing imported, so the client-side deep
 * link code never pulls the entity registry in behind it.
 */

export type TaskEntityTypeAliasGroup = {
  /** The generated entity id every spelling in the group means. */
  entityId: string
  /** Normalized spellings (`module:entity`, lower case) that authors write. */
  spellings: readonly string[]
}

/**
 * Alternate spellings that unambiguously mean one generated entity id.
 *
 * `customers:customer_entity` is deliberately absent — it backs both people and
 * companies, so no single id is the right answer and leaving a binding on it
 * unresolvable is the correct outcome.
 */
export const TASK_ENTITY_TYPE_ALIAS_GROUPS: readonly TaskEntityTypeAliasGroup[] = [
  {
    entityId: 'customers:customer_person_profile',
    spellings: ['customers:person', 'customers:people', 'customers:customer_person_profile'],
  },
  {
    entityId: 'customers:customer_company_profile',
    spellings: ['customers:company', 'customers:companies', 'customers:customer_company_profile'],
  },
  {
    entityId: 'customers:customer_deal',
    spellings: ['customers:deal', 'customers:deals', 'customers:customer_deal'],
  },
  {
    entityId: 'sales:sales_order',
    spellings: ['sales:order', 'sales:orders', 'sales:sales_order', 'sales:document'],
  },
]

const ALIAS_LOOKUP: ReadonlyMap<string, string> = new Map(
  TASK_ENTITY_TYPE_ALIAS_GROUPS.flatMap((group) =>
    group.spellings.map((spelling) => [spelling, group.entityId] as const),
  ),
)

/**
 * `Customers.Person` / `customers.person` / ` customers:person ` →
 * `customers:person`.
 *
 * Entity ids are written `module:entity` while record-detail injection contexts
 * use `module.entity` (`resourceKind`), and authors type both.
 */
export function normalizeTaskEntityTypeSpelling(entityType: string): string {
  return entityType.trim().toLowerCase().replace(/\./g, ':')
}

/** The generated entity id an enumerated spelling means, or `null`. */
export function resolveAliasedTaskEntityId(entityType: string): string | null {
  return ALIAS_LOOKUP.get(normalizeTaskEntityTypeSpelling(entityType)) ?? null
}

/** Every enumerated spelling, mapped to its generated entity id. */
export function listTaskEntityTypeAliases(): ReadonlyMap<string, string> {
  return ALIAS_LOOKUP
}
