import type { EntityExtension } from '@open-mercato/shared/modules/entities'

/**
 * EP-44 — cross-module entity links declared by the staff module.
 *
 * Per root `AGENTS.md`, modules do NOT form direct ORM relationships across boundaries.
 * `staff_time_entries.customer_id` / `.deal_id` / `.order_id` and
 * `staff_time_projects.customer_id` are plain uuid columns; the declarations below are
 * the traversal contract over them and nothing more. They contain **string ids only** —
 * no import of a customers or sales symbol — so they add no load-time dependency and
 * staff's `requires: ['planner', 'resources']` in `index.ts` does not grow. That matters:
 * staff is slated for extraction into a standalone package, and a link that pulled in
 * `@open-mercato/core/modules/customers` would break the extraction.
 *
 * `base` is the OTHER module's entity and `extension` is the staff entity that carries
 * the foreign key, matching every other `data/extensions.ts` in the repo — the query
 * engine only ever looks a link up by `base` (`shared/lib/query/engine.ts`,
 * `opts.includeExtensions`), joining the extension table onto the base entity's query.
 *
 * NOTE — declaration-only extension point, exactly as in
 * `apps/mercato/src/modules/example/data/extensions.ts`. Nothing in the platform passes
 * `includeExtensions` to a query today, the basic engine's extension join adds no
 * projection and exposes no filterable or sortable alias, and the hybrid engine DI
 * registers ignores the flag outside its basic-engine fallback. The declaration is still
 * the live contract: it is what `yarn generate` emits into the module registry as
 * `entityExtensions`, and it is what a reverse-navigation or join feature will read.
 *
 * `table` is declared rather than derived. The engine would reach the same names with
 * its regular pluralizer (`staff_time_entry` → `staff_time_entries`), but the explicit
 * form is pinned against the physical schema by `__tests__/entityExtensions.test.ts`.
 */
const entityExtensions: EntityExtension[] = [
  {
    base: 'customers:customer_entity',
    extension: 'staff:staff_time_entry',
    join: { baseKey: 'id', extensionKey: 'customer_id' },
    table: 'staff_time_entries',
    cardinality: 'one-to-many',
    description: 'Time logged directly against a customer record',
  },
  {
    base: 'customers:customer_deal',
    extension: 'staff:staff_time_entry',
    join: { baseKey: 'id', extensionKey: 'deal_id' },
    table: 'staff_time_entries',
    cardinality: 'one-to-many',
    description: 'Time logged against a CRM deal',
  },
  {
    base: 'sales:sales_order',
    extension: 'staff:staff_time_entry',
    join: { baseKey: 'id', extensionKey: 'order_id' },
    table: 'staff_time_entries',
    cardinality: 'one-to-many',
    description: 'Time logged against a sales order',
  },
  {
    base: 'customers:customer_entity',
    extension: 'staff:staff_time_project',
    join: { baseKey: 'id', extensionKey: 'customer_id' },
    table: 'staff_time_projects',
    cardinality: 'one-to-many',
    description: 'Time projects owned by a customer record (D-9: the customers supertype)',
  },
]

export const extensions = entityExtensions
export default entityExtensions
