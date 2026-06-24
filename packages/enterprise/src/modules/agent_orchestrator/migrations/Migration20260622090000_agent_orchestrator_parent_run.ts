import { Migration } from '@mikro-orm/migrations';

export class Migration20260622090000_agent_orchestrator_parent_run extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "agent_runs" add column "parent_run_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "agent_runs" drop column "parent_run_id";`);
  }

}
