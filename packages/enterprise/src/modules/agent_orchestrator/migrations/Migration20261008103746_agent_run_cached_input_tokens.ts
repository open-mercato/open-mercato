import { Migration } from '@mikro-orm/migrations'

/**
 * `agent_runs.cached_input_tokens` — the cached SUBSET of `input_tokens` (#6240).
 *
 * Stacked after the create-schema squash rather than folded into it: the squash
 * shipped in 0.8.0, so a database upgrading from that release has already
 * recorded it as applied and would never receive the column. `if not exists`
 * keeps it a no-op where the column was added out of band. Nullable with no
 * backfill: rows written before this column have an UNKNOWN cached share.
 */
export class Migration20261008103746_agent_run_cached_input_tokens extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "agent_runs" add column if not exists "cached_input_tokens" int null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "agent_runs" drop column if exists "cached_input_tokens";')
  }
}
