import { Migration } from '@mikro-orm/migrations'

export class Migration20260522000002 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "subscription_plans" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "code" text not null,
      "product_code" text not null,
      "title" text not null,
      "description" text null,
      "entitlements_json" jsonb null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "subscription_plans_pkey" primary key ("id")
    );`)

    this.addSql(`create unique index "subscription_plans_code_unique" on "subscription_plans" ("tenant_id", "organization_id", "code");`)
    this.addSql(`create index "subscription_plans_product_idx" on "subscription_plans" ("organization_id", "tenant_id", "product_code");`)

    this.addSql(`create table "subscription_prices" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "plan_id" uuid not null,
      "code" text not null,
      "provider_key" text not null,
      "currency_code" text not null,
      "interval" text not null,
      "interval_count" int not null,
      "unit_amount_minor" int not null,
      "trial_days" int null,
      "provider_product_ref" text null,
      "provider_price_ref" text null,
      "product_lookup_key" text not null,
      "price_lookup_key" text not null,
      "is_default" boolean not null default false,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "subscription_prices_pkey" primary key ("id"),
      constraint "subscription_prices_plan_fk" foreign key ("plan_id") references "subscription_plans" ("id") on delete cascade
    );`)

    this.addSql(`create unique index "subscription_prices_code_unique" on "subscription_prices" ("tenant_id", "organization_id", "code");`)
    this.addSql(`create index "subscription_prices_plan_idx" on "subscription_prices" ("organization_id", "tenant_id", "plan_id");`)

    this.addSql(`create table "subscriptions" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "external_account_id" text not null,
      "subject_entity_type" text not null,
      "subject_entity_id" uuid not null,
      "plan_id" uuid not null,
      "price_id" uuid not null,
      "provider_key" text not null,
      "provider_customer_id" text not null,
      "provider_subscription_id" text null,
      "provider_status" text not null,
      "access_state" text not null,
      "current_period_start" timestamptz null,
      "current_period_end" timestamptz null,
      "trial_ends_at" timestamptz null,
      "cancel_at_period_end" boolean not null default false,
      "cancelled_at" timestamptz null,
      "last_provider_event_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "subscriptions_pkey" primary key ("id"),
      constraint "subscriptions_plan_fk" foreign key ("plan_id") references "subscription_plans" ("id"),
      constraint "subscriptions_price_fk" foreign key ("price_id") references "subscription_prices" ("id")
    );`)

    this.addSql(`create index "subscriptions_account_idx" on "subscriptions" ("organization_id", "tenant_id", "external_account_id");`)
    this.addSql(`create index "subscriptions_state_idx" on "subscriptions" ("organization_id", "tenant_id", "access_state");`)
    this.addSql(`create index "subscriptions_provider_idx" on "subscriptions" ("provider_key", "provider_subscription_id");`)
    this.addSql(`create unique index "subscriptions_active_account_plan_unique" on "subscriptions" ("tenant_id", "organization_id", "external_account_id", "plan_id") where "deleted_at" is null and "access_state" <> 'blocked';`)

    this.addSql(`create table "subscription_billing_records" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "subscription_id" uuid not null,
      "provider_key" text not null,
      "provider_invoice_id" text null,
      "provider_payment_intent_id" text null,
      "provider_charge_id" text null,
      "status" text not null,
      "amount_minor" int not null,
      "currency_code" text not null,
      "period_start" timestamptz null,
      "period_end" timestamptz null,
      "event_type" text not null,
      "processed_at" timestamptz not null default now(),
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "subscription_billing_records_pkey" primary key ("id"),
      constraint "subscription_billing_records_subscription_fk" foreign key ("subscription_id") references "subscriptions" ("id") on delete cascade
    );`)

    this.addSql(`create index "subscription_billing_subscription_idx" on "subscription_billing_records" ("organization_id", "tenant_id", "subscription_id");`)
    this.addSql(`create unique index "subscription_billing_invoice_status_unique" on "subscription_billing_records" ("provider_key", "provider_invoice_id", "status") where "provider_invoice_id" is not null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "subscription_billing_records";`)
    this.addSql(`drop table if exists "subscriptions";`)
    this.addSql(`drop table if exists "subscription_prices";`)
    this.addSql(`drop table if exists "subscription_plans";`)
  }
}
