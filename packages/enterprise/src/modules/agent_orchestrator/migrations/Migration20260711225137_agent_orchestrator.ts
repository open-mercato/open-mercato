import { Migration } from '@mikro-orm/migrations';

export class Migration20260711225137_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_runs" add column if not exists "flagged_at" timestamptz null, add column if not exists "flagged_by" uuid null, add column if not exists "rerun_of_run_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_runs" drop column if exists "flagged_at", drop column if exists "flagged_by", drop column if exists "rerun_of_run_id";`);
  }

}
