import { Migration } from '@mikro-orm/migrations';

export class Migration20260121082330 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "resources_resources" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "resource_type_id" uuid null, "capacity" int null, "capacity_unit_value" text null, "capacity_unit_name" text null, "capacity_unit_color" text null, "capacity_unit_icon" text null, "appearance_icon" text null, "appearance_color" text null, "is_active" boolean not null default true, "availability_rule_set_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "resources_resources_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resources_tenant_org_idx" on "resources_resources" ("tenant_id", "organization_id");`);

    this.addSql(`create table "resources_resource_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "resources_resource_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_tags_scope_idx" on "resources_resource_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "resources_resource_tags" add constraint "resources_resource_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "resources_resource_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "resource_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "resources_resource_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_tag_assignments_scope_idx" on "resources_resource_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_unique" unique ("tag_id", "resource_id");`);

    this.addSql(`create table "resources_resource_types" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "resources_resource_types_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_types_tenant_org_idx" on "resources_resource_types" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "resources_resource_tags" ("id") on update cascade;`);
    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "resources_resource_tag_assignments" drop constraint "resources_resource_tag_assignments_resource_id_foreign";`);
    this.addSql(`alter table "resources_resource_tag_assignments" drop constraint "resources_resource_tag_assignments_tag_id_foreign";`);
    this.addSql(`drop index "resources_resource_tag_assignments_scope_idx";`);
    this.addSql(`drop index "resources_resource_tags_scope_idx";`);
    this.addSql(`drop index "resources_resources_tenant_org_idx";`);
    this.addSql(`drop index "resources_resource_types_tenant_org_idx";`);
    this.addSql(`drop table "resources_resource_tag_assignments";`);
    this.addSql(`drop table "resources_resource_tags";`);
    this.addSql(`drop table "resources_resources";`);
    this.addSql(`drop table "resources_resource_types";`);
  }

}
