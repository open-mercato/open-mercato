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
// Operational safety on the target 221M-row/~100GB table (why this migration is
// NOT transactional):
//   1. The index is built with CREATE UNIQUE INDEX CONCURRENTLY so it never holds
//      a table-level write lock for the duration of the build. CONCURRENTLY cannot
//      run inside a transaction, hence isTransactional() => false. The migration
//      runner applies migrations one-by-one, so this opt-out is safe.
//   2. Duplicates are removed first with a ctid-keyed self-join delete (ctid is
//      cheaper than comparing the random-UUID primary key and lets Postgres keep
//      exactly one physical row per tuple).
//   3. A CONCURRENTLY build leaves an INVALID index behind if it is interrupted or
//      if a new duplicate is written in the gap before the app deploys the
//      ON CONFLICT code. We drop any pre-existing invalid index first so a rerun
//      is clean; if a build fails, drop the invalid index and rerun this migration.
//
// For an operator whose table is already pathologically large, the fastest
// recovery is the workaround from the issue — TRUNCATE search_tokens and run a
// single controlled reindex — after which this migration builds the index on an
// empty/small table instantly. This migration is written to also work in place.
export class Migration20260730120000_query_index extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    // Drop a possible leftover INVALID index from an interrupted prior run.
    this.addSql(`drop index if exists "search_tokens_unique_tuple_idx";`);

    // De-duplicate existing rows, keeping one physical row (lowest ctid) per tuple.
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
        and t.ctid > d.ctid;
    `);

    this.addSql(
      `create unique index concurrently if not exists "search_tokens_unique_tuple_idx" on "search_tokens" ` +
      `("entity_type", "entity_id", "field", "token_hash", ` +
      `coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid), ` +
      `coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "search_tokens_unique_tuple_idx";`);
  }

}
