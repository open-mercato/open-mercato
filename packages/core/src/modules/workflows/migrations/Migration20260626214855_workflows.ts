import { Migration } from '@mikro-orm/migrations';

export class Migration20260626214855_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "workflow_definitions" add "kind" varchar(20) not null default 'workflow', add "lifecycle" varchar(20) not null default 'published';`);
    this.addSql(`create index "workflow_definitions_kind_idx" on "workflow_definitions" ("kind");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "workflow_definitions_kind_idx";`);
    this.addSql(`alter table "workflow_definitions" drop column "kind", drop column "lifecycle";`);
  }

}
