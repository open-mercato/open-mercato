import { Migration } from '@mikro-orm/migrations';

// Release 5 Phase 4 (checkout C3/C19, D-R5-30, Ask First already approved). Checkout's
// idempotent document creation (§7.2 step 5a) looks up a `SalesQuote` by
// `(tenant_id, external_reference)` BEFORE calling `sales.quotes.create`, on every submit
// attempt and every recovery/retry — `external_reference` carried no index at all before
// this migration (only `quote_number` and `acceptance_token` are indexed/unique), so that
// lookup was a full scan. Non-unique: `external_reference` is nullable and most quotes
// (anything not created by checkout) never set it, so a plain btree on the two columns
// checkout's own lookup already filters by is the correct shape — no uniqueness constraint
// is implied by this Step's own design (the uniqueness checkout relies on comes from the
// `'checkout:' + sessionId + ':' + attempt` string itself, not a DB constraint).
//
// Built CONCURRENTLY per this module's own established precedent for a non-trivial table
// (Migration20260806120000/20260821120000/20260916120000) — drop first so a retried
// concurrent build removes a prior INVALID stub rather than reporting success over an
// unindexed table.
export class Migration20261028010000_sales_quotes_external_reference_idx extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_quotes_tenant_external_reference_idx";`);
    this.addSql(`create index concurrently "sales_quotes_tenant_external_reference_idx" on "sales_quotes" ("tenant_id", "external_reference");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_quotes_tenant_external_reference_idx";`);
  }

}
