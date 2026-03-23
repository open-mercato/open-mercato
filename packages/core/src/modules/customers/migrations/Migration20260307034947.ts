import { Migration } from '@mikro-orm/migrations';

export class Migration20260307034947 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_deal_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int not null default 0, "product_id" uuid null, "product_variant_id" uuid null, "name" text not null, "sku" text null, "description" text null, "quantity" numeric(18,6) not null default 1, "unit" text null, "unit_price" numeric(14,2) not null default 0, "discount_percent" numeric(5,2) null default 0, "discount_amount" numeric(14,2) null default 0, "tax_rate" numeric(7,4) null, "line_total" numeric(14,2) not null default 0, "currency" varchar(3) null, "product_snapshot" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "deal_id" uuid not null, constraint "customer_deal_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deal_lines_org_idx" on "customer_deal_lines" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_deal_lines_product_idx" on "customer_deal_lines" ("product_id", "organization_id");`);
    this.addSql(`create index "customer_deal_lines_deal_idx" on "customer_deal_lines" ("deal_id");`);

    this.addSql(`alter table "customer_deal_lines" add constraint "customer_deal_lines_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql('alter table "customer_deal_lines" drop constraint if exists "customer_deal_lines_deal_id_foreign";');
    this.addSql('drop table if exists "customer_deal_lines" cascade;');
  }

}
