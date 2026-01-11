import { Migration } from '@mikro-orm/migrations';

export class Migration20260111141922 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "fms_charge_codes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "description" text null, "charge_unit" text not null, "field_schema" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "created_by" uuid null, "updated_at" timestamptz not null, "updated_by" uuid null, "deleted_at" timestamptz null, constraint "fms_charge_codes_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_charge_codes_scope_idx" on "fms_charge_codes" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "fms_charge_codes" add constraint "fms_charge_codes_code_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create table "fms_products" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "charge_code_id" uuid not null, "service_provider_id" uuid not null, "description" text null, "internal_notes" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "created_by" uuid null, "updated_at" timestamptz not null, "updated_by" uuid null, "deleted_at" timestamptz null, "product_type" text check ("product_type" in ('GBAF_PIECE', 'GBAF', 'GBOL', 'CUSTOM', 'GCUS', 'GFRT', 'GTHC')) not null, "loop" text null, "source_id" uuid null, "destination_id" uuid null, "transit_time" int null, "location_id" uuid null, constraint "fms_products_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_products_product_type_index" on "fms_products" ("product_type");`);
    this.addSql(`create index "fms_products_active_idx" on "fms_products" ("organization_id", "tenant_id", "is_active");`);
    this.addSql(`create index "fms_products_contractor_idx" on "fms_products" ("service_provider_id");`);
    this.addSql(`create index "fms_products_charge_code_idx" on "fms_products" ("charge_code_id");`);
    this.addSql(`create index "fms_products_scope_idx" on "fms_products" ("organization_id", "tenant_id");`);

    this.addSql(`create table "fms_product_variants" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "provider_id" uuid not null, "name" text null, "is_default" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "created_by" uuid null, "updated_at" timestamptz not null, "updated_by" uuid null, "deleted_at" timestamptz null, "variant_type" text check ("variant_type" in ('container', 'simple')) not null, "container_size" text null, "container_type" text null, "weight_limit" numeric(10,0) null, "weight_unit" text null, constraint "fms_product_variants_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_product_variants_variant_type_index" on "fms_product_variants" ("variant_type");`);
    this.addSql(`create index "fms_product_variants_product_idx" on "fms_product_variants" ("product_id");`);
    this.addSql(`create index "fms_product_variants_scope_idx" on "fms_product_variants" ("organization_id", "tenant_id");`);

    this.addSql(`create table "fms_product_prices" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "variant_id" uuid not null, "validity_start" date not null, "validity_end" date null, "contract_type" text not null, "contract_number" text null, "price" numeric(18,2) not null, "currency_code" text not null default 'USD', "is_active" boolean not null default true, "created_at" timestamptz not null, "created_by" uuid null, "updated_at" timestamptz not null, "updated_by" uuid null, "deleted_at" timestamptz null, constraint "fms_product_prices_pkey" primary key ("id"));`);
    this.addSql(`create index "fms_product_prices_active_idx" on "fms_product_prices" ("variant_id", "is_active", "validity_start", "validity_end");`);
    this.addSql(`create index "fms_product_prices_contract_idx" on "fms_product_prices" ("contract_type", "contract_number");`);
    this.addSql(`create index "fms_product_prices_validity_idx" on "fms_product_prices" ("variant_id", "validity_start", "validity_end");`);
    this.addSql(`create index "fms_product_prices_variant_idx" on "fms_product_prices" ("variant_id");`);
    this.addSql(`create index "fms_product_prices_scope_idx" on "fms_product_prices" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "fms_products" add constraint "fms_products_charge_code_id_foreign" foreign key ("charge_code_id") references "fms_charge_codes" ("id") on update cascade on delete restrict;`);
    this.addSql(`alter table "fms_products" add constraint "fms_products_service_provider_id_foreign" foreign key ("service_provider_id") references "contractors" ("id") on update cascade on delete restrict;`);
    this.addSql(`alter table "fms_products" add constraint "fms_products_source_id_foreign" foreign key ("source_id") references "fms_locations" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "fms_products" add constraint "fms_products_destination_id_foreign" foreign key ("destination_id") references "fms_locations" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "fms_products" add constraint "fms_products_location_id_foreign" foreign key ("location_id") references "fms_locations" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "fms_product_variants" add constraint "fms_product_variants_product_id_foreign" foreign key ("product_id") references "fms_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "fms_product_variants" add constraint "fms_product_variants_provider_id_foreign" foreign key ("provider_id") references "contractors" ("id") on update cascade on delete restrict;`);

    this.addSql(`alter table "fms_product_prices" add constraint "fms_product_prices_variant_id_foreign" foreign key ("variant_id") references "fms_product_variants" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_products" drop constraint "fms_products_charge_code_id_foreign";`);

    this.addSql(`alter table "fms_product_variants" drop constraint "fms_product_variants_product_id_foreign";`);

    this.addSql(`alter table "fms_product_prices" drop constraint "fms_product_prices_variant_id_foreign";`);
  }

}
