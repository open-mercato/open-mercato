import { Migration } from '@mikro-orm/migrations';

export class Migration20260712135724_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_runs" add column if not exists "completed_at" timestamptz null;`);
    // One-time backfill: `updated_at` is the best available approximation of the
    // completion time for pre-existing terminal rows. Rows flagged before this
    // migration carry their flag time instead — a bounded, documented skew
    // (previously the displayed value was always `updated_at`, i.e. always wrong).
    this.addSql(
      `update "agent_runs" set "completed_at" = "updated_at" where "status" in ('ok', 'error', 'cancelled') and "completed_at" is null;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_runs" drop column if exists "completed_at";`);
  }

}
