import { Migration } from '@mikro-orm/migrations';

export class Migration20260705121601_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "warranty_claim_registrations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "serial_number" text null, "product_id" uuid null, "variant_id" uuid null, "sku" text null, "product_name" text null, "customer_id" uuid null, "order_id" uuid null, "purchase_date" timestamptz null, "warranty_months" int null, "warranty_expires_at" timestamptz null, "coverage_type" text null, "source" text null, "proof_attachment_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_registrations_customer_idx" on "warranty_claim_registrations" ("tenant_id", "organization_id", "customer_id");`);
    this.addSql(`create index "warranty_claim_registrations_serial_idx" on "warranty_claim_registrations" ("tenant_id", "organization_id", "serial_number");`);

    this.addSql(`create table "warranty_claim_troubleshooting_guides" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_type" text null, "reason_code" text null, "title" text not null, "steps" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_troubleshooting_guides_lookup_idx" on "warranty_claim_troubleshooting_guides" ("tenant_id", "organization_id", "claim_type", "reason_code");`);

    this.addSql(`create table "warranty_claim_vendor_policies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "vendor_name" text not null, "vendor_ref" text null, "coverage_months" int null, "claimable_reason_codes" jsonb null, "recovery_rate_pct" numeric(5,2) null, "contact_email" text null, "auto_generate_recovery" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_vendor_policies_vendor_idx" on "warranty_claim_vendor_policies" ("tenant_id", "organization_id", "vendor_name");`);

    this.addSql(`alter table "warranty_claims" add "return_label_url" text null, add "return_tracking_number" text null, add "return_carrier" text null, add "escalation_level" int not null default 0, add "escalated_at" timestamptz null, add "intake_message_ref" text null, add "entitlement_source" text null;`);
    this.addSql(`create unique index "warranty_claims_intake_message_ref_unique" on "warranty_claims" ("tenant_id", "organization_id", "intake_message_ref") where "intake_message_ref" is not null and "deleted_at" is null;`);

    this.addSql(`alter table "warranty_claim_lines" add "condition_grade" text null, add "quarantine_status" text not null default 'none', add "assessment_payload" jsonb null, add "vendor_name" text null;`);

    this.addSql(`alter table "warranty_claim_settings" add "business_hours" jsonb null, add "escalation_tiers" jsonb null, add "adjudication_use_rules" boolean not null default false, add "quarantine_grades" jsonb null, add "return_label_provider" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "warranty_claim_vendor_policies" cascade;`);
    this.addSql(`drop table if exists "warranty_claim_troubleshooting_guides" cascade;`);
    this.addSql(`drop table if exists "warranty_claim_registrations" cascade;`);

    this.addSql(`alter table "warranty_claim_lines" drop column "condition_grade", drop column "quarantine_status", drop column "assessment_payload", drop column "vendor_name";`);

    this.addSql(`alter table "warranty_claim_settings" drop column "business_hours", drop column "escalation_tiers", drop column "adjudication_use_rules", drop column "quarantine_grades", drop column "return_label_provider";`);

    this.addSql(`drop index if exists "warranty_claims_intake_message_ref_unique";`);
    this.addSql(`alter table "warranty_claims" drop column "return_label_url", drop column "return_tracking_number", drop column "return_carrier", drop column "escalation_level", drop column "escalated_at", drop column "intake_message_ref", drop column "entitlement_source";`);
  }

}
