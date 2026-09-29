/**
 * What counts as an order, in the two shapes the SQL needs.
 *
 * Lifted out of `subject-document.ts` so that anything reading orders can share the definition without
 * importing the document builder — the RFM boundary sweep needs exactly this clause and nothing else, and an
 * import cycle to get it would be a fragile way to save a file.
 *
 * Both spellings of cancelled are excluded because the codebase tolerates both
 * (`sales/commands/documents.ts` → `isCancelledOrderStatus`), and `placed_at is not null` excludes drafts,
 * which would otherwise inflate a customer's order count with carts they never submitted.
 *
 * Every consumer must use the SAME definition. The subject document computes a customer's aggregates from it
 * and the set-level narrowing selects candidates with it, so if the two ever drifted the narrowing would stop
 * being a superset of what membership decides and customers would silently fall out of campaigns. The RFM cut
 * points rank the same orders for the same reason: a quintile over a different population is a different
 * number wearing the same name.
 */
export const PLACED_ORDER_FILTER_SQL = `
  tenant_id = ?
    and organization_id = ?
    and deleted_at is null
    and placed_at is not null
    and (status is null or status not in ('canceled', 'cancelled'))
`

/**
 * The same "order that counts" rule as `PLACED_ORDER_FILTER_SQL`, written for a joined query.
 *
 * Spelled out with the alias rather than derived from the other constant by string surgery: two
 * readable clauses that must be kept in step are safer than one clause mangled at runtime, and the
 * unit test asserts they stay equivalent.
 */
export const PLACED_ORDER_FILTER_SQL_ALIASED = `
  o.tenant_id = ?
    and o.organization_id = ?
    and o.deleted_at is null
    and o.placed_at is not null
    and (o.status is null or o.status not in ('canceled', 'cancelled'))
`
