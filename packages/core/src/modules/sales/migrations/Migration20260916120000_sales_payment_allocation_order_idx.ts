import { Migration } from '@mikro-orm/migrations';

// sales_payment_allocations carried a single index — (payment_id, organization_id,
// tenant_id) — which serves the reads that start from a payment. Every such read in
// commands/payments.ts is `{ payment }`, so that index has always matched them.
//
// The table is also read from the ORDER side, and that direction was unindexed.
// Recomputing an order's payment totals does:
//
//   findWithDecryption(em, SalesPaymentAllocation, { ...scope, order: orderId },
//                      { populate: ['payment'] }, scope)
//
// which the ORM emits filtered on (organization_id, tenant_id, order_id), inner
// joined to sales_payments. That recompute runs on every payment create, update and
// delete, so one order with two payments performs it several times. commands/
// documents.ts reads the same way in four more places — one em.find in the
// sales.orders.delete snapshot and three nativeDelete({ order }) calls, the latter
// taking row locks while they scan.
//
// Measured on a table of 1.4M rows / 364 MB: a parallel sequential scan removing
// 478,376 rows per worker, 28.6 ms per read to return one row. Buffers: shared
// hit=23757 — roughly 185 MB touched per call, which on a 2 GB shared_buffers
// evicts the working set the rest of the write path depends on, so the cost is not
// confined to the statement that pays it.
//
// order_id alone, and the scope columns deliberately omitted, for the reason given
// in Migration20260821120000: sales_orders.id is gen_random_uuid() from its own
// table, so an order_id already determines its tenant and organization. The seek
// returns the handful of rows belonging to one order and the remaining terms are
// rechecked over those; folding two more uuids in would roughly triple the entry
// for no selectivity. The sibling scope index predates that reasoning.
//
// The index is also what the foreign key needs: sales_payment_allocations_order_id_
// foreign is `on delete set null`, which PostgreSQL does not index automatically, so
// without it every delete of a parent order scans this table in full.
//
// Built CONCURRENTLY — the table takes a write per payment allocation and is large
// on any install that has been running a while. CREATE INDEX CONCURRENTLY cannot run
// inside a transaction, hence isTransactional() => false; the runner applies
// migrations one-by-one, so the opt-out is safe. Drop first so retrying a failed
// concurrent build removes PostgreSQL's INVALID index stub instead of letting IF NOT
// EXISTS report success over a table that stays unindexed. Same shape as
// Migration20260806120000 and Migration20260821120000.
export class Migration20260916120000_sales_payment_allocation_order_idx extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_payment_allocations_order_idx";`);
    this.addSql(`create index concurrently "sales_payment_allocations_order_idx" on "sales_payment_allocations" ("order_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_payment_allocations_order_idx";`);
  }

}
