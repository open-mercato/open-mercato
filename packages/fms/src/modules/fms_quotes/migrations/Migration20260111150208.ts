import { Migration } from '@mikro-orm/migrations';

export class Migration20260111150208 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "fms_quote_lines" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int not null default 0, "product_id" uuid null, "variant_id" uuid null, "price_id" uuid null, "product_name" text not null, "charge_code" text null, "product_type" text null, "provider_name" text null, "container_size" text null, "contract_type" text null, "quantity" numeric(18,4) not null default '1', "currency_code" text not null default 'USD', "unit_cost" numeric(18,4) not null default '0', "margin_percent" numeric(8,4) not null default '0', "unit_sales" numeric(18,4) not null default '0', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "fms_quote_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_quote_lines_quote_idx" on "fms_quote_lines" ("quote_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "fms_quote_lines_org_tenant_idx" on "fms_quote_lines" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "fms_quote_lines" add constraint "fms_quote_lines_quote_id_foreign" foreign key ("quote_id") references "fms_quotes" ("id") on update cascade;`);
  }

}
