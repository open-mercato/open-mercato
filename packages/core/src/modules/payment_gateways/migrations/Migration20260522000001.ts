import { Migration } from '@mikro-orm/migrations'

export class Migration20260522000001 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "gateway_subscription_mappings" (
      "id" uuid not null default gen_random_uuid(),
      "provider_key" text not null,
      "provider_subscription_id" text null,
      "provider_customer_id" text not null,
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "external_account_id" text not null,
      "subscription_id" uuid null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      constraint "gateway_subscription_mappings_pkey" primary key ("id")
    );`)

    this.addSql(`create unique index "gw_sub_map_provider_sub_unique" on "gateway_subscription_mappings" ("provider_key", "provider_subscription_id") where "provider_subscription_id" is not null;`)
    this.addSql(`create index "gw_sub_map_provider_customer" on "gateway_subscription_mappings" ("provider_key", "provider_customer_id");`)
    this.addSql(`create index "gw_sub_map_org_tenant_account" on "gateway_subscription_mappings" ("organization_id", "tenant_id", "external_account_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "gateway_subscription_mappings";`)
  }
}
