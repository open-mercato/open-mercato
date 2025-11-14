import { Migration } from '@mikro-orm/migrations';

export class Migration20251114184759 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_option_schema_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "schema" jsonb not null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_option_schema_templates_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_option_schema_templates_scope_idx" on "catalog_option_schema_templates" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_option_schema_templates" add constraint "catalog_option_schema_templates_code_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`alter table "catalog_products" drop constraint "catalog_products_code_scope_unique";`);

    this.addSql(`alter table "catalog_products" add column "sku" text null, add column "handle" text null, add column "option_schema_id" uuid null;`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_option_schema_id_foreign" foreign key ("option_schema_id") references "catalog_option_schema_templates" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_products" rename column "name" to "title";`);
    this.addSql(`alter table "catalog_products" rename column "code" to "subtitle";`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_handle_scope_unique" unique ("organization_id", "tenant_id", "handle");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_sku_scope_unique" unique ("organization_id", "tenant_id", "sku");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop constraint "catalog_products_option_schema_id_foreign";`);

    this.addSql(`alter table "catalog_products" drop constraint "catalog_products_handle_scope_unique";`);
    this.addSql(`alter table "catalog_products" drop constraint "catalog_products_sku_scope_unique";`);
    this.addSql(`alter table "catalog_products" drop column "sku", drop column "handle", drop column "option_schema_id";`);

    this.addSql(`alter table "catalog_products" rename column "title" to "name";`);
    this.addSql(`alter table "catalog_products" rename column "subtitle" to "code";`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);
  }

}
