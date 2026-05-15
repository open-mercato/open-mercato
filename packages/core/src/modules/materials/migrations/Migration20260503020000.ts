import { Migration } from '@mikro-orm/migrations'

export class Migration20260503020000 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`create table "material_supplier_links" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "material_id" uuid not null,
      "supplier_company_id" uuid not null,
      "supplier_sku" text null,
      "min_order_qty" numeric(18,6) null,
      "lead_time_days" integer null,
      "preferred" boolean not null default false,
      "notes" text null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      primary key ("id")
    );`)

    this.addSql(`create index "material_supplier_links_material_idx" on "material_supplier_links" ("material_id");`)
    this.addSql(`create index "material_supplier_links_supplier_idx" on "material_supplier_links" ("supplier_company_id");`)
    // At most one preferred supplier per material (live rows only).
    this.addSql(`create unique index "material_supplier_links_preferred_unique" on "material_supplier_links" ("material_id") where preferred = true and deleted_at is null;`)
    // No duplicate supplier links for the same (material, supplier) pair (live rows only).
    this.addSql(`create unique index "material_supplier_links_material_supplier_unique" on "material_supplier_links" ("material_id", "supplier_company_id") where deleted_at is null;`)
    // Sanity: lead time can't be negative; min order qty must be positive when present.
    this.addSql(`alter table "material_supplier_links" add constraint "material_supplier_links_lead_time_nonneg" check ("lead_time_days" is null or "lead_time_days" >= 0);`)
    this.addSql(`alter table "material_supplier_links" add constraint "material_supplier_links_moq_positive" check ("min_order_qty" is null or "min_order_qty" > 0);`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "material_supplier_links" cascade;`)
  }
}
