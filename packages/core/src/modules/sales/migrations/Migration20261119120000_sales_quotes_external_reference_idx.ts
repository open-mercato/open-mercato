import { Migration } from '@mikro-orm/migrations';

// Release 5 SA1 (checkout C3, D-R5-30). Checkout's idempotent quote creation (§8.6)
// looks up a `SalesQuote` by `(tenant_id, external_reference)` BEFORE calling
// `sales.quotes.create`, on every submit attempt and every recovery probe.
// `external_reference` carried no index before this migration, so that lookup was a
// full scan. Non-unique: `external_reference` is nullable and most quotes never set
// it; the uniqueness checkout relies on comes from the
// `'checkout:' + sessionId + ':' + attempt` string itself, not a DB constraint.
//
// Built CONCURRENTLY, like Migration20260806120000/20260821120000/20260916120000.
// CREATE INDEX CONCURRENTLY cannot run inside a transaction, hence
// isTransactional() => false. Drop first so a retried concurrent build removes a
// prior INVALID stub rather than reporting success over an unindexed table.
export class Migration20261119120000_sales_quotes_external_reference_idx extends Migration {

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
