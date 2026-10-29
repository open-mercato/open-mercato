import { Migration } from '@mikro-orm/migrations';

export class Migration20261029090000_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "workflow_instances" add "wait_version" int not null default 0;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "workflow_instances" drop column "wait_version";`);
  }

}
