import { Migration } from '@mikro-orm/migrations'

export class Migration20260527140000_wms extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`
      create table "wms_sales_order_warehouse_assignments" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "sales_order_id" uuid not null,
        "warehouse_id" uuid not null,
        "assigned_by" uuid,
        "notes" text,
        "metadata" jsonb,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz,
        constraint "wms_sowa_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index "wms_sowa_org_tenant_idx" on "wms_sales_order_warehouse_assignments" ("organization_id", "tenant_id");`,
    )
    this.addSql(
      `create index "wms_sowa_warehouse_idx" on "wms_sales_order_warehouse_assignments" ("warehouse_id");`,
    )
    this.addSql(
      `create unique index "wms_sowa_org_order_unique_idx" on "wms_sales_order_warehouse_assignments" ("organization_id", "sales_order_id") where deleted_at is null;`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "wms_sales_order_warehouse_assignments";`)
  }
}
