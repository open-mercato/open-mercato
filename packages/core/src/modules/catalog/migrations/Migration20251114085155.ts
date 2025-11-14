import { Migration } from '@mikro-orm/migrations';

export class Migration20251114085155 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_attribute_schemas" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "schema" jsonb not null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "catalog_attribute_schemas_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_attribute_schemas_scope_idx" on "catalog_attribute_schemas" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_attribute_schemas" add constraint "catalog_attribute_schemas_code_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`alter table "catalog_products" add column "attribute_schema_id" uuid null;`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_attribute_schema_id_foreign" foreign key ("attribute_schema_id") references "catalog_attribute_schemas" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop constraint "catalog_products_attribute_schema_id_foreign";`);

    this.addSql(`alter table "catalog_products" drop column "attribute_schema_id";`);
  }

}
