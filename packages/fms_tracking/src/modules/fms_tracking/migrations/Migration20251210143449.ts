import { Migration } from '@mikro-orm/migrations';

export class Migration20251210143449 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "fms_tracking_freighttech_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "api_key" text not null default '', "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "fms_tracking_settings_pkey" primary key ("id"));`);
    this.addSql(`alter table "fms_tracking_freighttech_settings" add constraint "fms_tracking_freighttech_settings_scope_unique" unique ("organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "fms_tracking_freighttech_settings" cascade;`);
  }
}
