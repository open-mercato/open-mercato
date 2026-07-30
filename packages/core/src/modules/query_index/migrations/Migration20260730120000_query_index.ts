import { Migration } from '@mikro-orm/migrations';

// #4681: search_tokens had no unique constraint on the token tuple, so the
// DELETE+INSERT token replacement (replaceSearchTokensForRecord/-Batch) was not
// idempotent under READ COMMITTED concurrency: one job's INSERT could land after
// another's DELETE and both token sets survived, duplicating every
// (field, token_hash) at exact integer multiples until the table reached 221M
// rows / 100GB for a few thousand records.
//
// Fix: enforce a coalesced UNIQUE index on the token tuple and switch token
// INSERTs to ON CONFLICT DO NOTHING. The scope columns are nullable and Postgres
// treats NULLs as distinct, so the index folds NULL organization_id/tenant_id to
// a sentinel zero UUID — otherwise the global-scope rows (the ones that actually
// blew up) would stay un-deduplicated.
//
// Existing rows are de-duplicated first (keeping the lowest id per tuple) so the
// unique index build cannot fail on pre-existing duplicates. The dedup + the
// non-concurrent index build run outside a single implicit transaction wrapper
// only where required; here we keep it transactional so the dedup and the index
// creation are atomic.
export class Migration20260730120000_query_index extends Migration {

  override async up(): Promise<void> {
    const scopeExpr =
      `entity_type, entity_id, field, token_hash, ` +
      `coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), ` +
      `coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)`;

    // De-duplicate existing rows, keeping the lowest id per token tuple.
    this.addSql(`
      delete from "search_tokens" t
      using "search_tokens" d
      where t."entity_type" = d."entity_type"
        and t."entity_id" = d."entity_id"
        and t."field" = d."field"
        and t."token_hash" = d."token_hash"
        and coalesce(t."organization_id", '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(d."organization_id", '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(t."tenant_id", '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(d."tenant_id", '00000000-0000-0000-0000-000000000000'::uuid)
        and t."id" > d."id";
    `);

    this.addSql(
      `create unique index if not exists "search_tokens_unique_tuple_idx" on "search_tokens" (${scopeExpr});`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "search_tokens_unique_tuple_idx";`);
  }

}
