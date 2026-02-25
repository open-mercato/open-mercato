import { Migration } from '@mikro-orm/migrations';

export class Migration20260218180716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_product_option_schemas" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "schema" jsonb not null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_product_option_schemas_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_option_schemas_scope_idx" on "catalog_product_option_schemas" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_option_schemas" add constraint "catalog_product_option_schemas_code_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create table "catalog_price_kinds" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid not null, "code" text not null, "title" text not null, "display_mode" text not null default 'excluding-tax', "currency_code" text null, "is_promotion" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_price_kinds_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_price_kinds_tenant_idx" on "catalog_price_kinds" ("tenant_id");`);
    this.addSql(`alter table "catalog_price_kinds" add constraint "catalog_price_kinds_code_tenant_unique" unique ("tenant_id", "code");`);

    this.addSql(`create table "catalog_products" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "subtitle" text null, "description" text null, "sku" text null, "handle" text null, "tax_rate_id" uuid null, "tax_rate" numeric(7,4) null, "product_type" text not null default 'simple', "status_entry_id" uuid null, "primary_currency_code" text null, "default_unit" text null, "default_media_id" uuid null, "default_media_url" text null, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "metadata" jsonb null, "custom_fieldset_code" text null, "option_schema_id" uuid null, "is_configurable" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_products_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_products_org_tenant_idx" on "catalog_products" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_handle_scope_unique" unique ("organization_id", "tenant_id", "handle");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_sku_scope_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "catalog_product_offers" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "channel_id" uuid not null, "title" text not null, "description" text null, "default_media_id" uuid null, "default_media_url" text null, "localized_content" jsonb null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_product_offers_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_offers_scope_idx" on "catalog_product_offers" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_channel_unique" unique ("product_id", "organization_id", "tenant_id", "channel_id");`);

    this.addSql(`create table "catalog_product_categories" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "slug" text null, "description" text null, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_product_categories_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_categories_scope_idx" on "catalog_product_categories" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_categories" add constraint "catalog_product_categories_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "catalog_product_category_assignments" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "category_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "position" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_category_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_category_assignments_scope_idx" on "catalog_product_category_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_unique" unique ("product_id", "category_id");`);

    this.addSql(`create table "catalog_product_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "label" text not null, "slug" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_tags_scope_idx" on "catalog_product_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tags" add constraint "catalog_product_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "catalog_product_tag_assignments" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "tag_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_tag_assignments_scope_idx" on "catalog_product_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_unique" unique ("product_id", "tag_id");`);

    this.addSql(`create table "catalog_product_variants" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "name" text null, "sku" text null, "barcode" text null, "status_entry_id" text null, "is_default" boolean not null default false, "is_active" boolean not null default true, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "metadata" jsonb null, "tax_rate_id" uuid null, "tax_rate" numeric(7,4) null, "option_values" jsonb null, "custom_fieldset_code" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_product_variants_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variants_scope_idx" on "catalog_product_variants" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_sku_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "catalog_product_variant_prices" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid null, "product_id" uuid null, "offer_id" uuid null, "price_kind_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "currency_code" text not null, "kind" text not null default 'regular', "min_quantity" int not null default 1, "max_quantity" int null, "unit_price_net" numeric(16,4) null, "unit_price_gross" numeric(16,4) null, "tax_rate" numeric(7,4) null, "tax_amount" numeric(16,4) null, "channel_id" uuid null, "user_id" uuid null, "user_group_id" uuid null, "customer_id" uuid null, "customer_group_id" uuid null, "metadata" jsonb null, "starts_at" timestamptz null, "ends_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_variant_prices_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variant_prices_product_scope_idx" on "catalog_product_variant_prices" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_variant_prices_variant_scope_idx" on "catalog_product_variant_prices" ("variant_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_variant_relations" ("id" uuid not null default gen_random_uuid(), "parent_variant_id" uuid not null, "child_variant_id" uuid null, "child_product_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "relation_type" text not null default 'grouped', "is_required" boolean not null default false, "min_quantity" int null, "max_quantity" int null, "position" int not null default 0, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_variant_relations_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variant_relations_child_product_idx" on "catalog_product_variant_relations" ("child_product_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_variant_relations_child_idx" on "catalog_product_variant_relations" ("child_variant_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_variant_relations_parent_idx" on "catalog_product_variant_relations" ("parent_variant_id", "organization_id", "tenant_id");`);

    this.addSql(`alter table "catalog_products" add constraint "catalog_products_option_schema_id_foreign" foreign key ("option_schema_id") references "catalog_product_option_schemas" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_category_id_foreign" foreign key ("category_id") references "catalog_product_categories" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "catalog_product_tags" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade;`);

    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_offer_id_foreign" foreign key ("offer_id") references "catalog_product_offers" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_price_kind_id_foreign" foreign key ("price_kind_id") references "catalog_price_kinds" ("id") on update cascade on delete restrict;`);

    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_parent_variant_id_foreign" foreign key ("parent_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_child_variant_id_foreign" foreign key ("child_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_child_product_id_foreign" foreign key ("child_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop constraint "catalog_products_option_schema_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_price_kind_id_foreign";`);

    this.addSql(`alter table "catalog_product_offers" drop constraint "catalog_product_offers_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_category_assignments" drop constraint "catalog_product_category_assignments_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_tag_assignments" drop constraint "catalog_product_tag_assignments_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_variants" drop constraint "catalog_product_variants_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_child_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_offer_id_foreign";`);

    this.addSql(`alter table "catalog_product_category_assignments" drop constraint "catalog_product_category_assignments_category_id_foreign";`);

    this.addSql(`alter table "catalog_product_tag_assignments" drop constraint "catalog_product_tag_assignments_tag_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_variant_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_parent_variant_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_child_variant_id_foreign";`);
  }

}
