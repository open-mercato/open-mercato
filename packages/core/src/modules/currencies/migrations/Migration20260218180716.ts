import { Migration } from '@mikro-orm/migrations';

export class Migration20260218180716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "currencies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "symbol" text null, "decimal_places" int not null default 2, "thousands_separator" text null, "decimal_separator" text null, "is_base" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "currencies_pkey" primary key ("id"));`);
    this.addSql(`create index "currencies_scope_idx" on "currencies" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "currencies" add constraint "currencies_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create table "currency_fetch_configs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "provider" text not null, "is_enabled" boolean not null default false, "sync_time" text null, "last_sync_at" timestamptz null, "last_sync_status" text null, "last_sync_message" text null, "last_sync_count" int null, "config" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "currency_fetch_configs_pkey" primary key ("id"));`);
    this.addSql(`create index "currency_fetch_configs_enabled_idx" on "currency_fetch_configs" ("is_enabled", "sync_time");`);
    this.addSql(`create index "currency_fetch_configs_scope_idx" on "currency_fetch_configs" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "currency_fetch_configs" add constraint "currency_fetch_configs_provider_scope_unique" unique ("organization_id", "tenant_id", "provider");`);

    this.addSql(`create table "exchange_rates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "from_currency_code" text not null, "to_currency_code" text not null, "rate" numeric(18,8) not null, "date" timestamptz not null, "source" text not null, "type" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "exchange_rates_pkey" primary key ("id"));`);
    this.addSql(`create index "exchange_rates_pair_idx" on "exchange_rates" ("from_currency_code", "to_currency_code", "date");`);
    this.addSql(`create index "exchange_rates_scope_idx" on "exchange_rates" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_datetime_source_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "date", "source");`);
  }

}
