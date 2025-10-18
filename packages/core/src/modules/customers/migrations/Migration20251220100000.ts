import { Migration } from '@mikro-orm/migrations'

export class Migration20251220100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "customer_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "address_format" text not null default 'line_first', "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_settings_pkey" primary key ("id"));`)
    this.addSql(`create unique index "customer_settings_scope_unique" on "customer_settings" ("organization_id", "tenant_id");`)
    this.addSql(`alter table "customer_addresses" add column "building_number" text null;`)
    this.addSql(`alter table "customer_addresses" add column "flat_number" text null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "customer_addresses" drop column if exists "building_number";`)
    this.addSql(`alter table "customer_addresses" drop column if exists "flat_number";`)
    this.addSql(`drop table if exists "customer_settings" cascade;`)
  }
}
