import { Migration } from '@mikro-orm/migrations';

export class Migration20260706102002_eudr extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "eudr_due_diligence_statements" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "commodity" text not null, "reference_number" text null, "verification_number" text null, "status" text not null default 'draft', "quantity_kg" numeric(14,3) null, "order_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);

    this.addSql(`create table "eudr_evidence_submissions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "supplier_entity_id" uuid not null, "supplier_snapshot" jsonb null, "commodity" text not null, "product_mapping_id" uuid null, "statement_id" uuid null, "origin_country" text null, "geolocation" jsonb null, "quantity_kg" numeric(14,3) null, "batch_number" text null, "harvest_from" timestamptz null, "harvest_to" timestamptz null, "producer_name" text null, "attachment_ids" jsonb not null default '[]', "status" text not null default 'draft', "completeness_score" int not null default 0, "missing_fields" jsonb not null default '[]', "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "idx_eudr_submissions_supplier" on "eudr_evidence_submissions" ("supplier_entity_id");`);
    this.addSql(`create index "idx_eudr_submissions_statement" on "eudr_evidence_submissions" ("statement_id");`);

    this.addSql(`create table "eudr_product_mappings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "product_snapshot" jsonb null, "commodity" text not null, "hs_code" text null, "is_in_scope" boolean not null default true, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "idx_eudr_mappings_org_product_commodity_unique" on "eudr_product_mappings" ("organization_id", "product_id", "commodity") where deleted_at is null;`);
  }

}
