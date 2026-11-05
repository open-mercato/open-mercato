import { Migration } from '@mikro-orm/migrations';

// #2966: TokenSearchStrategy — the always-available global-search fallback —
// filters search_tokens by token_hash IN (...) AND tenant_id on every
// keystroke, but both existing indexes lead with entity_type (and the lookup
// index interposes field, which the query never filters), so the per-keystroke
// lookup degrades to a sequential scan as the table grows. Add a
// (tenant_id, token_hash)-leading index so it becomes an index scan.
//
// search_tokens is high-churn (rows scale with records × tokens), so the
// index is built CONCURRENTLY to avoid blocking writes during the build.
// CREATE INDEX CONCURRENTLY cannot run inside a transaction, hence
// isTransactional() => false; the migration runner applies migrations
// one-by-one, so this opt-out is safe.
export class Migration20260611103000_query_index extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`create index concurrently if not exists "search_tokens_tenant_token_hash_idx" on "search_tokens" ("tenant_id", "token_hash");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "search_tokens_tenant_token_hash_idx";`);
  }

}
