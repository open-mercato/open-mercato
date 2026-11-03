import { Migration } from '@mikro-orm/migrations';

// sales_payment_allocations carried a single non-PK index — (payment_id,
// organization_id, tenant_id) — which serves the reads that start from a payment.
// Every such read in commands/payments.ts is `{ payment }`, so that index has
// always matched them, and its leading column also serves the payment_id foreign
// key's referential check. Nothing here replaces it.
//
// The table is also read from the ORDER side, and that direction was unindexed.
// Recomputing an order's payment totals does:
//
//   findWithDecryption(em, SalesPaymentAllocation, { ...scope, order: orderId },
//                      { populate: ['payment'] }, scope)
//
// which the ORM emits filtered on (organization_id, tenant_id, order_id), inner
// joined to sales_payments — `payment` is a required to-one, and the default
// BALANCED load strategy joins those. That recompute runs on every payment create,
// update and delete. commands/documents.ts reads the same way in four more places:
// one em.find in the sales.orders.delete snapshot, and three nativeDelete({ order })
// calls that take row locks while they scan.
//
// Measured on a table of 1.4M rows: a parallel sequential scan removing 478,376 rows
// per worker, 28.6 ms per read to return one row. The cost is CPU filtering across
// 23,757 buffer accesses, so a warm cache does not reduce it — the plan that
// measured this reported every one of those buffers as `shared hit`.
//
// order_id and invoice_id are indexed separately rather than folded into the index
// above, and the scope columns are deliberately omitted, for the reason given in
// Migration20260821120000: sales_orders.id is gen_random_uuid() from its own table,
// so an order_id already determines its tenant and organization. Four of the five
// order-side reads supply no scope at all, so a composite would serve none of them
// better; the seek returns the rows of one order and any remaining terms are
// rechecked over those.
//
// invoice_id gets the same treatment on the foreign key's account alone. Both
// columns are the child side of `on delete set null` constraints, which PostgreSQL
// does not index automatically, and the constraint check probes the referencing
// column — so without these, every delete of a parent order or invoice scans this
// table in full. Both parents really are hard-deleted (commands/documents.ts). This
// is the same pairing Migration20260821120000 made for order_id and quote_id.
//
// Built CONCURRENTLY — the table takes a write per payment allocation and is large
// on any install that has been running a while. CREATE INDEX CONCURRENTLY cannot run
// inside a transaction, hence isTransactional() => false; the runner applies
// migrations one-by-one, so the opt-out is safe. Drop first so retrying a failed
// concurrent build removes PostgreSQL's INVALID index stub instead of letting IF NOT
// EXISTS report success over a table that stays unindexed. Same shape as
// Migration20260806120000 and Migration20260821120000.
//
// On a database that does not have these indexes yet — every fresh install — the
// drops are no-ops and there is no window without them. An operator who already
// created one out of band should expect it to be rebuilt here, and the reads that
// depend on it to fall back to their pre-index cost until the concurrent build
// finishes; on a large table, run this while the writers that depend on it are
// paused.
export class Migration20260916120000_sales_payment_allocation_order_idx extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_payment_allocations_order_idx";`);
    this.addSql(`create index concurrently "sales_payment_allocations_order_idx" on "sales_payment_allocations" ("order_id");`);
    this.addSql(`drop index concurrently if exists "sales_payment_allocations_invoice_idx";`);
    this.addSql(`create index concurrently "sales_payment_allocations_invoice_idx" on "sales_payment_allocations" ("invoice_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_payment_allocations_invoice_idx";`);
    this.addSql(`drop index concurrently if exists "sales_payment_allocations_order_idx";`);
  }

}
