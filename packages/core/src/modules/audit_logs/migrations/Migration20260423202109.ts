import { Migration } from '@mikro-orm/migrations';

export class Migration20260423202109 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "action_logs" add "related_resource_kind" text null, add "related_resource_id" text null;`);
    this.addSql(`create index "action_logs_related_resource_idx" on "action_logs" ("tenant_id", "related_resource_kind", "related_resource_id", "created_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "action_logs_related_resource_idx";`);
    this.addSql(`alter table "action_logs" drop column "related_resource_kind", drop column "related_resource_id";`);
  }

}
