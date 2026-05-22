import { Migration } from '@mikro-orm/migrations';

export class Migration20260412160533 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "action_logs" add column "action_type" text null, add column "changed_fields" text[] null, add column "primary_changed_field" text null, add column "source_key" text null;`);
    this.addSql(`create index "action_logs_changed_fields_idx" on "action_logs" using gin ("changed_fields");`);
    this.addSql(`create index "action_logs_primary_changed_field_idx" on "action_logs" ("tenant_id", "organization_id", "primary_changed_field", "created_at");`);
    this.addSql(`create index "action_logs_source_key_idx" on "action_logs" ("tenant_id", "organization_id", "source_key", "created_at");`);
    this.addSql(`create index "action_logs_action_type_idx" on "action_logs" ("tenant_id", "organization_id", "action_type", "created_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "action_logs_changed_fields_idx";`);
    this.addSql(`drop index "action_logs_primary_changed_field_idx";`);
    this.addSql(`drop index "action_logs_source_key_idx";`);
    this.addSql(`drop index "action_logs_action_type_idx";`);
    this.addSql(`alter table "action_logs" drop column "action_type", drop column "changed_fields", drop column "primary_changed_field", drop column "source_key";`);
  }

}
