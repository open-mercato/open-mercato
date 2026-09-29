import { Migration } from '@mikro-orm/migrations';

export class Migration20260602120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "user_devices" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "user_id" uuid not null, "device_id" text not null, "platform" text not null, "client_app_version" text null, "os_version" text null, "push_token" text null, "push_provider" text null, "push_token_updated_at" timestamptz null, "last_seen_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "user_devices_pkey" primary key ("id"));`);
    this.addSql(`create index "user_devices_tenant_user_idx" on "user_devices" ("tenant_id", "user_id");`);
    this.addSql(`create unique index "user_devices_tenant_user_device_active_unique" on "user_devices" ("tenant_id", "user_id", "device_id") where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "user_devices" cascade;`);
  }

}
