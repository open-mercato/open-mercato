import { Migration } from '@mikro-orm/migrations';

export class Migration20251008154648 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "tenants" ("id" uuid not null default gen_random_uuid(), "name" text not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "tenants_pkey" primary key ("id"));`);

    this.addSql(`create table "organizations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "name" text not null, "is_active" boolean not null default true, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "organizations_pkey" primary key ("id"));`);

    this.addSql(`alter table "organizations" add constraint "organizations_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "organizations" drop constraint "organizations_tenant_id_foreign";`);

    this.addSql(`drop table if exists "tenants" cascade;`);

    this.addSql(`drop table if exists "organizations" cascade;`);
  }

}
