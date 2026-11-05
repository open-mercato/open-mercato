import { Migration } from '@mikro-orm/migrations';

export class Migration20260703191537_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "warranty_claims" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_number" text not null, "claim_type" text not null, "status" text not null default 'draft', "channel" text not null default 'staff', "priority" text not null default 'normal', "customer_id" uuid null, "customer_name" text null, "vendor_name" text null, "vendor_ref" text null, "order_id" uuid null, "sales_return_id" uuid null, "replacement_order_id" uuid null, "source_claim_id" uuid null, "advance_replacement" boolean not null default false, "advance_shipped_at" timestamptz null, "reason_code" text null, "rejection_reason_code" text null, "resolution_summary" text null, "notes" text null, "currency_code" text null, "total_claimed_amount" numeric(18,4) null, "total_approved_amount" numeric(18,4) null, "total_recovered_amount" numeric(18,4) null, "sla_due_at" timestamptz null, "submitted_at" timestamptz null, "resolved_at" timestamptz null, "closed_at" timestamptz null, "assignee_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "warranty_claims_status_idx" on "warranty_claims" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "warranty_claims_order_idx" on "warranty_claims" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "warranty_claims_customer_idx" on "warranty_claims" ("customer_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "warranty_claims" add constraint "warranty_claims_number_unique" unique ("tenant_id", "organization_id", "claim_number");`);

    this.addSql(`create table "warranty_claim_events" ("id" uuid not null default gen_random_uuid(), "claim_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "visibility" text not null default 'internal', "body" text null, "payload" jsonb null, "actor_user_id" uuid null, "actor_customer_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_events_claim_created_idx" on "warranty_claim_events" ("claim_id", "created_at");`);

    this.addSql(`create table "warranty_claim_lines" ("id" uuid not null default gen_random_uuid(), "claim_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_no" int not null, "product_id" uuid null, "variant_id" uuid null, "sku" text null, "product_name" text null, "order_line_id" uuid null, "serial_number" text null, "lot_number" text null, "purchase_date" timestamptz null, "warranty_months" int null, "warranty_expires_at" timestamptz null, "warranty_status" text not null default 'unknown', "fault_code" text null, "fault_description" text null, "qty_claimed" numeric(18,4) not null default '1', "qty_approved" numeric(18,4) null, "qty_received" numeric(18,4) null, "condition_on_receipt" text null, "inspection_notes" text null, "disposition" text null, "line_status" text not null default 'pending', "credit_amount" numeric(18,4) null, "restocking_fee" numeric(18,4) null, "core_charge_amount" numeric(18,4) null, "core_credit_amount" numeric(18,4) null, "vendor_claim_line_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_lines_product_idx" on "warranty_claim_lines" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "warranty_claim_lines_order_line_idx" on "warranty_claim_lines" ("order_line_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "warranty_claim_lines_claim_idx" on "warranty_claim_lines" ("claim_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "warranty_claim_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_type" text not null, "next_number" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "warranty_claim_sequences" add constraint "warranty_claim_sequences_type_unique" unique ("tenant_id", "organization_id", "claim_type");`);

    this.addSql(`alter table "warranty_claim_events" add constraint "warranty_claim_events_claim_id_foreign" foreign key ("claim_id") references "warranty_claims" ("id");`);

    this.addSql(`alter table "warranty_claim_lines" add constraint "warranty_claim_lines_claim_id_foreign" foreign key ("claim_id") references "warranty_claims" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "warranty_claim_events" drop constraint if exists "warranty_claim_events_claim_id_foreign";`);
    this.addSql(`alter table "warranty_claim_lines" drop constraint if exists "warranty_claim_lines_claim_id_foreign";`);

    this.addSql(`drop table if exists "warranty_claim_sequences" cascade;`);
    this.addSql(`drop table if exists "warranty_claim_lines" cascade;`);
    this.addSql(`drop table if exists "warranty_claim_events" cascade;`);
    this.addSql(`drop table if exists "warranty_claims" cascade;`);
  }

}
