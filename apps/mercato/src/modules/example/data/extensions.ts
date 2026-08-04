import type { EntityExtension } from '@open-mercato/shared/modules/entities'

/**
 * Cross-module entity link declared by the example module.
 *
 * `ExampleCustomerPriority` adds a priority to a customer record without an ORM
 * relationship to `customers` — the ban on cross-module relations means the link
 * is a plain `customer_id` uuid column plus this declaration, which is what the
 * generators and the data engine traverse.
 *
 * `table` is mandatory here: the query engine otherwise derives the extension
 * table by appending an `s` to the entity segment, producing
 * `example_customer_prioritys` instead of the real `example_customer_priorities`.
 * `__tests__/entity-extensions.test.ts` pins the declaration to the physical
 * schema in `migrations/.snapshot-open-mercato.json`.
 *
 * NOTE — declaration-only extension point. Nothing in this module (or in the
 * platform) passes `includeExtensions` to a query at runtime, and doing so would
 * not surface this data today: the basic query engine's extension join adds no
 * projection and exposes no filterable/sortable alias, and the hybrid engine that
 * DI actually registers ignores the flag outside its basic-engine fallback. The
 * declaration is still the live contract — it is what `yarn generate` emits into
 * the module registry as `entityExtensions`.
 */
const entityExtensions: EntityExtension[] = [
  {
    base: 'customers:customer_entity',
    extension: 'example:example_customer_priority',
    join: { baseKey: 'id', extensionKey: 'customer_id' },
    table: 'example_customer_priorities',
    cardinality: 'one-to-one',
    description:
      'Links a customer record to the example module per-customer priority used by the injected column, filter and CRUD form field',
  },
]

export const extensions = entityExtensions
export default entityExtensions
