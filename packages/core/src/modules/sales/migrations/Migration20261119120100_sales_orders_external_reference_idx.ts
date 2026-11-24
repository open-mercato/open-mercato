import { Migration } from '@mikro-orm/migrations';

// Release 5 SA1 (checkout C3, D-R5-CH1). Checkout creates the order directly with
// `sales.orders.create` and keys its idempotency on the order's own
// `external_reference`: submit (§7.2 step 5a) and recovery (§12.1) look up a
// `SalesOrder` by `(tenant_id, external_reference)` before creating one.
// `sales_orders.external_reference` carried no index before this migration.
// Non-unique, and a hash rather than a B-tree, for the same reasons as the quote
// index (Migration20261119120000_sales_quotes_external_reference_idx): the column is
// unbounded text, so a B-tree key could exceed the entry-size limit on existing rows
// or later updates.
//
// Built CONCURRENTLY — sales_orders takes writes on every order change — so
// isTransactional() => false, and dropped first so a retried build replaces an
// INVALID stub.
export class Migration20261119120100_sales_orders_external_reference_idx extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_orders_external_reference_hash_idx";`);
    this.addSql(`create index concurrently "sales_orders_external_reference_hash_idx" on "sales_orders" using hash ("external_reference");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_orders_external_reference_hash_idx";`);
  }

}
