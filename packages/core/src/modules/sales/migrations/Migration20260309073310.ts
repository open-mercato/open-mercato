import { Migration } from '@mikro-orm/migrations';

export class Migration20260309073310 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sales_returns" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "return_number" text not null, "status_entry_id" uuid null, "status" text null, "reason" text null, "notes" text null, "returned_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sales_returns_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_returns_status_idx" on "sales_returns" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "sales_returns_scope_idx" on "sales_returns" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_returns" add constraint "sales_returns_number_unique" unique ("organization_id", "tenant_id", "return_number");`);

    this.addSql(`create table "sales_return_lines" ("id" uuid not null default gen_random_uuid(), "return_id" uuid not null, "order_line_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "quantity_returned" numeric(18,4) not null default '0', "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sales_return_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_return_lines_order_line_idx" on "sales_return_lines" ("order_line_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_return_lines_return_idx" on "sales_return_lines" ("return_id", "organization_id", "tenant_id");`);

    this.addSql(`alter table "sales_returns" add constraint "sales_returns_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade;`);

    this.addSql(`alter table "sales_return_lines" add constraint "sales_return_lines_return_id_foreign" foreign key ("return_id") references "sales_returns" ("id") on update cascade;`);
    this.addSql(`alter table "sales_return_lines" add constraint "sales_return_lines_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sales_return_lines" cascade;`);
    this.addSql(`drop table if exists "sales_returns" cascade;`);
  }

}
