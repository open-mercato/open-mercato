import { Migration } from '@mikro-orm/migrations';

export class Migration20260922095844_availability extends Migration {

  override name = 'Migration20260922095844';

  override up(): void | Promise<void> {
    this.addSql(`create table "availability_policies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid null, "product_id" uuid null, "variant_id" uuid null, "is_stock_managed" boolean not null default false, "allow_backorder" boolean not null default false, "backorder_lead_time_days" int null, "preorder_release_at" timestamptz null, "low_stock_threshold" int null, "min_order_quantity" int null, "max_order_quantity" int null, "quantity_increment" int null, "hide_when_out_of_stock" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "availability_policies_scope_target_unique" on "availability_policies" ("tenant_id", "organization_id", "store_id", "product_id", "variant_id") nulls not distinct where deleted_at is null;`);
    this.addSql(`create index "availability_policies_scope_idx" on "availability_policies" ("tenant_id", "organization_id");`);
  }

}
