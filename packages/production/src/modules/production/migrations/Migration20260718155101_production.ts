import { Migration } from '@mikro-orm/migrations';

export class Migration20260718155101_production extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "production_material_reservations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid null, "order_material_id" uuid null, "stock_item_id" uuid not null, "batch_id" uuid null, "qty" numeric(18,6) not null, "uom" text not null, "status" text not null default 'active', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_material_reservations_stock_item_idx" on "production_material_reservations" ("stock_item_id");`);
    this.addSql(`create index "production_material_reservations_tenant_org_idx" on "production_material_reservations" ("tenant_id", "organization_id");`);

    this.addSql(`create table "production_stock_batches" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "stock_item_id" uuid not null, "batch_number" text not null, "on_hand" numeric(18,6) not null default 0, "expires_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_stock_batches_stock_item_idx" on "production_stock_batches" ("stock_item_id");`);
    this.addSql(`create index "production_stock_batches_tenant_org_idx" on "production_stock_batches" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_stock_batches" add constraint "production_stock_batches_item_number_unique" unique ("stock_item_id", "batch_number");`);

    this.addSql(`create table "production_stock_items" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "uom" text not null, "on_hand" numeric(18,6) not null default 0, "reserved" numeric(18,6) not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_stock_items_tenant_org_idx" on "production_stock_items" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_stock_items" add constraint "production_stock_items_scope_product_unique" unique ("tenant_id", "organization_id", "product_id", "variant_id");`);

    this.addSql(`create table "production_stock_movements" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "movement_type" text not null, "product_id" uuid not null, "variant_id" uuid null, "batch_id" uuid null, "qty" numeric(18,6) not null, "uom" text not null, "reason_entry_id" uuid null, "source_type" text not null, "source_id" uuid null, "reverses_movement_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "production_stock_movements_product_idx" on "production_stock_movements" ("product_id", "variant_id");`);
    this.addSql(`create index "production_stock_movements_tenant_org_idx" on "production_stock_movements" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "production_stock_movements" add constraint "production_stock_movements_reverses_unique" unique ("reverses_movement_id");`);

    this.addSql(`alter table "production_material_reservations" add constraint "production_material_reservations_status_check" check ("status" in ('active', 'released', 'consumed'));`);

    this.addSql(`alter table "production_stock_movements" add constraint "production_stock_movements_movement_type_check" check ("movement_type" in ('receipt', 'issue', 'adjustment'));`);
    this.addSql(`alter table "production_stock_movements" add constraint "production_stock_movements_source_type_check" check ("source_type" in ('order', 'report', 'import', 'manual'));`);
  }

}
