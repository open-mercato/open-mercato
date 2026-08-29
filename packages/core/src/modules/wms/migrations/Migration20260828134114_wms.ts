import { Migration } from '@mikro-orm/migrations';

export class Migration20260828134114_wms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "wms_sites" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "code" text not null, "name" text not null, "is_active" boolean not null default false, primary key ("id"));`);
    this.addSql(`create unique index "wms_sites_org_code_unique_idx" on "wms_sites" ("tenant_id", "organization_id", lower("code")) where deleted_at is null;`);
    this.addSql(`create index "wms_sites_org_tenant_idx" on "wms_sites" ("organization_id", "tenant_id");`);

    this.addSql(`create table "wms_site_warehouse_roles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "site_id" uuid not null, "warehouse_id" uuid not null, "role" text not null, "is_default" boolean not null default false, primary key ("id"));`);
    this.addSql(`create unique index "wms_site_warehouse_roles_default_unique_idx" on "wms_site_warehouse_roles" ("site_id", "role") where is_default = true and deleted_at is null;`);
    this.addSql(`create unique index "wms_site_warehouse_roles_unique_idx" on "wms_site_warehouse_roles" ("site_id", "role", "warehouse_id") where deleted_at is null;`);
    this.addSql(`create index "wms_site_warehouse_roles_org_tenant_warehouse_idx" on "wms_site_warehouse_roles" ("organization_id", "tenant_id", "warehouse_id");`);
    this.addSql(`create index "wms_site_warehouse_roles_org_tenant_site_idx" on "wms_site_warehouse_roles" ("organization_id", "tenant_id", "site_id");`);

    this.addSql(`alter table "wms_site_warehouse_roles" add constraint "wms_site_warehouse_roles_site_id_foreign" foreign key ("site_id") references "wms_sites" ("id");`);
    this.addSql(`alter table "wms_site_warehouse_roles" add constraint "wms_site_warehouse_roles_warehouse_id_foreign" foreign key ("warehouse_id") references "wms_warehouses" ("id");`);

  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_site_warehouse_roles" drop constraint if exists "wms_site_warehouse_roles_site_id_foreign";`);

    this.addSql(`alter table "wms_site_warehouse_roles" drop constraint if exists "wms_site_warehouse_roles_warehouse_id_foreign";`);
    this.addSql(`drop table if exists "wms_site_warehouse_roles";`);
    this.addSql(`drop table if exists "wms_sites";`);
  }

}
