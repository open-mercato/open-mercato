import { Migration } from '@mikro-orm/migrations';

export class Migration20251230120933 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "currencies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "symbol" text null, "decimal_places" int not null default 2, "thousands_separator" text null, "decimal_separator" text null, "is_base" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "currencies_pkey" primary key ("id"));`);
    this.addSql(`create index "currencies_scope_idx" on "currencies" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "currencies" add constraint "currencies_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create table "exchange_rates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "from_currency_code" text not null, "to_currency_code" text not null, "rate" numeric(18,8) not null, "effective_date" timestamptz not null, "expires_at" timestamptz null, "source" text not null default 'manual', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "exchange_rates_pkey" primary key ("id"));`);
    this.addSql(`create index "exchange_rates_pair_idx" on "exchange_rates" ("from_currency_code", "to_currency_code", "effective_date");`);
    this.addSql(`create index "exchange_rates_scope_idx" on "exchange_rates" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_date_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "effective_date");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "currencies" cascade;`);
    this.addSql(`drop table if exists "exchange_rates" cascade;`);
  }
}
