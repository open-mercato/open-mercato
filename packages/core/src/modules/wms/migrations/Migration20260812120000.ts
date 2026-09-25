import { Migration } from '@mikro-orm/migrations'

export class Migration20260812120000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `create table "wms_asns" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "warehouse_id" uuid not null, "vendor_id" uuid null, "status" text not null default 'draft', "expected_at" timestamptz not null, "reference_number" text null, "notes" text null, primary key ("id"));`,
    )
    this.addSql(
      `create index "wms_asns_org_warehouse_status_expected_idx" on "wms_asns" ("organization_id", "warehouse_id", "status", "expected_at");`,
    )
    this.addSql(
      `create index "wms_asns_org_vendor_expected_idx" on "wms_asns" ("organization_id", "vendor_id", "expected_at" desc) where deleted_at is null;`,
    )
    this.addSql(`create index "wms_asns_org_tenant_idx" on "wms_asns" ("organization_id", "tenant_id");`)

    this.addSql(
      `create table "wms_receiving_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "asn_id" uuid not null, "catalog_variant_id" uuid not null, "expected_qty" numeric(16,4) not null, "received_qty" numeric(16,4) not null default '0', "lot_number" text null, "serial_numbers" jsonb null, "qc_status" text not null default 'pending', "target_staging_location_id" uuid null, "rejection_reason" text null, primary key ("id"));`,
    )
    this.addSql(
      `create index "wms_receiving_lines_org_variant_qc_idx" on "wms_receiving_lines" ("organization_id", "catalog_variant_id", "qc_status");`,
    )
    this.addSql(
      `create index "wms_receiving_lines_org_asn_idx" on "wms_receiving_lines" ("organization_id", "asn_id");`,
    )
    this.addSql(
      `create index "wms_receiving_lines_org_tenant_idx" on "wms_receiving_lines" ("organization_id", "tenant_id");`,
    )

    this.addSql(
      `alter table "wms_asns" add constraint "wms_asns_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`,
    )
    this.addSql(
      `alter table "wms_receiving_lines" add constraint "wms_receiving_lines_asn_id_foreign" foreign key ("asn_id") references "wms_asns" ("id");`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_receiving_lines" drop constraint if exists "wms_receiving_lines_asn_id_foreign";`)
    this.addSql(`alter table "wms_asns" drop constraint if exists "wms_asns_warehouse_id_foreign";`)
    this.addSql(`drop table if exists "wms_receiving_lines" cascade;`)
    this.addSql(`drop table if exists "wms_asns" cascade;`)
  }
}
