import { Migration } from '@mikro-orm/migrations';

export class Migration20260719140737_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "agent_runs" add "source" varchar(20) not null default 'runtime';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "agent_runs" drop column "source";`);
  }

}
