import { Migration } from '@mikro-orm/migrations';

// Availability-probe index (.ai/specs/2026-07-31-search-token-probe-index.md).
// The query engines gate like/ilike routing on "does (entity_type, tenant, org)
// have any search tokens?". Neither existing index serves that probe as an
// access path — lookup_idx buries tenant_id behind field/token_hash — so on a
// large search_tokens the planner degraded the probe to a seq scan and the MISS
// answer had to exhaust every entry for the entity type (p95 12.5 s in
// production, #4723). With this (entity_type, tenant_id, organization_id)
// prefix and the index-usable `= / IS NULL` predicates the availability
// resolver emits, both the hit AND the miss become a B-tree prefix seek.
//
// search_tokens is high-churn, so the index is built CONCURRENTLY to avoid
// blocking writes during the build. CREATE INDEX CONCURRENTLY cannot run
// inside a transaction, hence isTransactional() => false; the migration runner
// applies migrations one-by-one, so this opt-out is safe (same pattern as
// Migration20260611103000_query_index). Drop first so retrying a failed
// concurrent build removes PostgreSQL's invalid index stub instead of letting
// IF NOT EXISTS silently accept it.
export class Migration20260731105052_query_index extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "search_tokens_presence_idx";`);
    this.addSql(`create index concurrently "search_tokens_presence_idx" on "search_tokens" ("entity_type", "tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "search_tokens_presence_idx";`);
  }

}
