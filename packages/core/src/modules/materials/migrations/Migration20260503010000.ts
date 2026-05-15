import { Migration } from '@mikro-orm/migrations'

export class Migration20260503010000 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`create table "material_units" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "material_id" uuid not null,
      "code" text not null,
      "label" text not null,
      "usage" text not null,
      "factor" numeric(18,6) not null default 1,
      "is_base" boolean not null default false,
      "is_default_for_usage" boolean not null default false,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      primary key ("id")
    );`)

    this.addSql(`create index "material_units_material_usage_idx" on "material_units" ("material_id", "usage");`)
    this.addSql(`create unique index "material_units_material_code_unique" on "material_units" ("material_id", "code") where deleted_at is null;`)
    // Exactly one base unit per material (when not soft-deleted).
    this.addSql(`create unique index "material_units_material_base_unique" on "material_units" ("material_id") where is_base = true and deleted_at is null;`)
    // At most one default unit per (material, usage) bucket.
    this.addSql(`create unique index "material_units_material_default_per_usage_unique" on "material_units" ("material_id", "usage") where is_default_for_usage = true and deleted_at is null;`)
    // Sanity: factor must be strictly positive. Domain guarantees factor=1 for the base unit
    // are enforced at command level (cheaper than a polymorphic check constraint).
    this.addSql(`alter table "material_units" add constraint "material_units_factor_positive" check ("factor" > 0);`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "material_units" cascade;`)
  }
}
