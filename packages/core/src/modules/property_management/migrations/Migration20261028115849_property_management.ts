import { Migration } from '@mikro-orm/migrations';

export class Migration20261028115849_property_management extends Migration {

  override name = 'Migration20261028115849';

  override up(): void | Promise<void> {
    this.addSql(`create table "property_management_leases" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "reference" text not null, "building_id" uuid not null, "unit_id" uuid not null, "customer_company_id" uuid not null, "primary_contact_person_id" uuid null, "status" text not null, "starts_on" date not null, "term_months" int not null, "ends_on" date not null, "current_version_id" uuid null, "hold_token" uuid null, "sales_order_id" uuid null, "pending_change" jsonb null, "billing_attention" boolean not null default false, "last_billing_refusal" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "property_management_leases_company_idx" on "property_management_leases" ("organization_id", "customer_company_id");`);
    this.addSql(`create index "property_management_leases_building_idx" on "property_management_leases" ("organization_id", "building_id");`);
    this.addSql(`create index "property_management_leases_unit_status_idx" on "property_management_leases" ("organization_id", "unit_id", "status");`);
    this.addSql(`alter table "property_management_leases" add constraint "property_management_leases_reference_unique" unique ("organization_id", "reference");`);

    this.addSql(`create table "property_management_lease_proposals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "lease_id" uuid not null, "version_id" uuid null, "kind" text not null, "sales_quote_id" uuid null, "sales_order_id" uuid null, "starts_on" date not null, "ends_on" date not null, "months" int not null, "monthly_rate" numeric(16,4) not null, "currency_code" text null, "message" text null, "expires_in_days" int not null, "respond_by" date not null, "status" text not null, "hold_token" uuid null, "answered_at" timestamptz null, "answered_by_customer_user_id" uuid null, "reminded_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "property_management_lease_proposals_open_unique" on "property_management_lease_proposals" ("lease_id") where "status" in ('sending', 'sent', 'declined');`);
    this.addSql(`create index "property_management_lease_proposals_status_idx" on "property_management_lease_proposals" ("organization_id", "status", "respond_by");`);
    this.addSql(`create index "property_management_lease_proposals_lease_idx" on "property_management_lease_proposals" ("organization_id", "lease_id");`);

    this.addSql(`create table "property_management_lease_reference_counters" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "year" int not null, "last_number" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "property_management_lease_reference_counters" add constraint "property_management_lease_reference_counters_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "property_management_lease_versions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "lease_id" uuid not null, "version_no" int not null, "event" text not null, "state" text not null, "catalog_product_id" uuid not null, "product_name" text not null, "monthly_rate" numeric(16,4) not null, "currency_code" text null, "starts_on" date not null, "ends_on" date not null, "months" int not null, "sales_order_id" uuid null, "sales_order_line_id" uuid null, "hold_token" uuid null, "effective_from" date not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "property_management_lease_versions_lease_idx" on "property_management_lease_versions" ("organization_id", "lease_id", "version_no");`);
    this.addSql(`alter table "property_management_lease_versions" add constraint "property_management_lease_versions_number_unique" unique ("lease_id", "version_no");`);

    this.addSql(`create table "property_management_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "billing_channel_id" uuid null, "cancelled_order_status_entry_id" uuid null, "lease_ending_threshold_days" int not null default 60, "booking_reminder_minutes" int not null default 60, "proposal_expiry_days" int not null default 14, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "property_management_settings" add constraint "property_management_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "property_management_sales_operations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "subject_key" text not null, "payload_hash" text not null, "payload" jsonb not null, "change_id" uuid null, "sequence" int not null default 1, "target_type" text not null, "target_id" uuid not null, "lease_id" uuid null, "status" text not null, "token" uuid not null, "allow_credit" boolean null, "sales_document_type" text null, "sales_document_id" uuid null, "sales_document_line_id" uuid null, "attempts" int not null default 0, "last_error" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "property_management_sales_operations_target_idx" on "property_management_sales_operations" ("organization_id", "target_type", "target_id");`);
    this.addSql(`create index "property_management_sales_operations_change_idx" on "property_management_sales_operations" ("organization_id", "change_id", "sequence");`);
    this.addSql(`create index "property_management_sales_operations_status_idx" on "property_management_sales_operations" ("organization_id", "status");`);
    this.addSql(`alter table "property_management_sales_operations" add constraint "property_management_sales_operations_subject_unique" unique ("organization_id", "subject_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "property_management_sales_operations" cascade;`);
    this.addSql(`drop table if exists "property_management_settings" cascade;`);
    this.addSql(`drop table if exists "property_management_lease_versions" cascade;`);
    this.addSql(`drop table if exists "property_management_lease_reference_counters" cascade;`);
    this.addSql(`drop table if exists "property_management_lease_proposals" cascade;`);
    this.addSql(`drop table if exists "property_management_leases" cascade;`);
  }

}
