import { Migration } from '@mikro-orm/migrations';

export class Migration20260616132847_catalog extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "catalog_services" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "description" text null, "scope" text null, "category_id" uuid null, "default_price_amount" numeric(16,4) null, "default_price_currency_code" text null, "default_media_id" uuid null, "default_media_url" text null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "catalog_services_category_idx" on "catalog_services" ("category_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_services_scope_idx" on "catalog_services" ("organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_service_media" ("id" uuid not null default gen_random_uuid(), "service_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "file_id" uuid null, "url" text null, "alt" text null, "content_type" text null, "sort_order" int not null default 0, "is_default" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "catalog_service_media_scope_idx" on "catalog_service_media" ("organization_id", "tenant_id", "service_id");`);

    this.addSql(`create table "catalog_service_work_requirements" ("id" uuid not null default gen_random_uuid(), "service_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "target_type" text not null, "target_id" uuid null, "label_snapshot" text not null, "allocation_mode" text not null, "allocation_value" numeric(16,4) not null, "sort_order" int not null default 0, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "catalog_service_work_requirements_target_idx" on "catalog_service_work_requirements" ("organization_id", "tenant_id", "target_type", "target_id");`);
    this.addSql(`create index "catalog_service_work_requirements_scope_idx" on "catalog_service_work_requirements" ("organization_id", "tenant_id", "service_id");`);

    this.addSql(`alter table "catalog_services" add constraint "catalog_services_category_id_foreign" foreign key ("category_id") references "catalog_product_categories" ("id") on delete set null;`);

    this.addSql(`alter table "catalog_service_media" add constraint "catalog_service_media_service_id_foreign" foreign key ("service_id") references "catalog_services" ("id") on delete cascade;`);

    this.addSql(`alter table "catalog_service_work_requirements" add constraint "catalog_service_work_requirements_service_id_foreign" foreign key ("service_id") references "catalog_services" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "catalog_service_media" drop constraint if exists "catalog_service_media_service_id_foreign";`);
    this.addSql(`alter table "catalog_service_work_requirements" drop constraint if exists "catalog_service_work_requirements_service_id_foreign";`);
  }

}
