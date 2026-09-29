import { Migration } from '@mikro-orm/migrations';

export class Migration20260730092706_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "workflow_instances" add "outcome" varchar(30) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "workflow_instances" drop column "outcome";`);
  }

}
