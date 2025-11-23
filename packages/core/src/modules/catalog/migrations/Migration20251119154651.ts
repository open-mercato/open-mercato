import { Migration } from '@mikro-orm/migrations';

export class Migration20251119154651 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_product_option_values" drop constraint "catalog_product_option_values_option_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_option_values" drop constraint "catalog_product_variant_option_values_option_value_id_foreign";`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "catalog_product_options" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int not null default 0, "is_required" boolean not null default false, "is_multiple" boolean not null default false, "input_type" text not null default 'select', "input_config" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_options_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_options_scope_idx" on "catalog_product_options" ("product_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_option_values" ("id" uuid not null default gen_random_uuid(), "option_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int not null default 0, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_option_values_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_option_values_scope_idx" on "catalog_product_option_values" ("option_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_option_values" add constraint "catalog_product_option_values_code_unique" unique ("organization_id", "tenant_id", "option_id", "code");`);

    this.addSql(`create table "catalog_product_variant_option_values" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid not null, "option_value_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_variant_option_values_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_product_variant_option_values" add constraint "catalog_product_variant_option_values_unique" unique ("variant_id", "option_value_id");`);

    this.addSql(`alter table "catalog_product_options" add constraint "catalog_product_options_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_product_option_values" add constraint "catalog_product_option_values_option_id_foreign" foreign key ("option_id") references "catalog_product_options" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_product_variant_option_values" add constraint "catalog_product_variant_option_values_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade;`);
    this.addSql(`alter table "catalog_product_variant_option_values" add constraint "catalog_product_variant_option_values_option_value_id_foreign" foreign key ("option_value_id") references "catalog_product_option_values" ("id") on update cascade;`);
  }

}
