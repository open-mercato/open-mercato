import { Migration } from '@mikro-orm/migrations';

export class Migration20260218110709 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index "action_logs_parent_resource_idx";`);
    this.addSql(`drop index "action_logs_resource_idx";`);
    this.addSql(`alter table "action_logs" drop column "parent_resource_kind", drop column "parent_resource_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "action_logs" add column "parent_resource_kind" text null, add column "parent_resource_id" text null;`);
    this.addSql(`create index "action_logs_parent_resource_idx" on "action_logs" ("tenant_id", "parent_resource_kind", "parent_resource_id", "created_at");`);
    this.addSql(`create index "action_logs_resource_idx" on "action_logs" ("tenant_id", "resource_kind", "resource_id", "created_at");`);
  }

}
