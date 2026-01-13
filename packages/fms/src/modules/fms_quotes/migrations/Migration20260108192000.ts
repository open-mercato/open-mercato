import { Migration } from '@mikro-orm/migrations';

export class Migration20260108192000 extends Migration {

  override async up(): Promise<void> {
    // Create fms_quotes table
    this.addSql(`create table "fms_quotes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_number" text not null, "status" text not null default 'draft', "direction" text not null, "incoterm" text null, "cargo_type" text not null, "origin_port_code" text null, "destination_port_code" text null, "valid_until" timestamptz null, "currency_code" text not null default 'USD', "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "fms_quotes_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_quotes_org_tenant_idx" on "fms_quotes" ("organization_id", "tenant_id");`);
    this.addSql(`create index "fms_quotes_status_idx" on "fms_quotes" ("organization_id", "tenant_id", "status");`);
    this.addSql(`alter table "fms_quotes" add constraint "fms_quotes_number_unique" unique ("organization_id", "tenant_id", "quote_number");`);

    // Create fms_offers table
    this.addSql(`create table "fms_offers" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "offer_number" text not null, "status" text not null default 'draft', "contract_type" text not null default 'spot', "carrier_name" text null, "valid_until" timestamptz null, "currency_code" text not null default 'USD', "total_amount" numeric(18,4) not null default '0', "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "fms_offers_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_offers_org_tenant_idx" on "fms_offers" ("organization_id", "tenant_id");`);
    this.addSql(`create index "fms_offers_quote_idx" on "fms_offers" ("quote_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "fms_offers_status_idx" on "fms_offers" ("organization_id", "tenant_id", "status");`);
    this.addSql(`alter table "fms_offers" add constraint "fms_offers_number_unique" unique ("organization_id", "tenant_id", "offer_number");`);

    // Create fms_offer_lines table
    this.addSql(`create table "fms_offer_lines" ("id" uuid not null default gen_random_uuid(), "offer_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int not null default 0, "charge_name" text not null, "charge_category" text not null, "charge_unit" text not null, "container_type" text null, "quantity" numeric(18,4) not null default '1', "currency_code" text not null, "unit_price" numeric(18,4) not null default '0', "amount" numeric(18,4) not null default '0', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "fms_offer_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_offer_lines_org_tenant_idx" on "fms_offer_lines" ("organization_id", "tenant_id");`);
    this.addSql(`create index "fms_offer_lines_offer_idx" on "fms_offer_lines" ("offer_id", "organization_id", "tenant_id");`);

    // Add foreign keys
    this.addSql(`alter table "fms_offers" add constraint "fms_offers_quote_id_foreign" foreign key ("quote_id") references "fms_quotes" ("id") on update cascade;`);
    this.addSql(`alter table "fms_offer_lines" add constraint "fms_offer_lines_offer_id_foreign" foreign key ("offer_id") references "fms_offers" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_offers" drop constraint "fms_offers_quote_id_foreign";`);
    this.addSql(`alter table "fms_offer_lines" drop constraint "fms_offer_lines_offer_id_foreign";`);
    this.addSql(`drop table if exists "fms_offer_lines" cascade;`);
    this.addSql(`drop table if exists "fms_offers" cascade;`);
    this.addSql(`drop table if exists "fms_quotes" cascade;`);
  }

}
