import { Migration } from '@mikro-orm/migrations';

export class Migration20251231132646 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "currency_fetch_configs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "provider" text not null, "is_enabled" boolean not null default false, "sync_time" text null, "last_sync_at" timestamptz null, "last_sync_status" text null, "last_sync_message" text null, "last_sync_count" int null, "config" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "currency_fetch_configs_pkey" primary key ("id"));`);
    this.addSql(`create index "currency_fetch_configs_enabled_idx" on "currency_fetch_configs" ("is_enabled", "sync_time");`);
    this.addSql(`create index "currency_fetch_configs_scope_idx" on "currency_fetch_configs" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "currency_fetch_configs" add constraint "currency_fetch_configs_provider_scope_unique" unique ("organization_id", "tenant_id", "provider");`);
  }

}
