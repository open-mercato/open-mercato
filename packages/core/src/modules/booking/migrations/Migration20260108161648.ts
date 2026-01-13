import { Migration } from '@mikro-orm/migrations';

export class Migration20260108161648 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "booking_resource_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "booking_resource_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_resource_tags_scope_idx" on "booking_resource_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "booking_resource_tags" add constraint "booking_resource_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "booking_resource_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "resource_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "booking_resource_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_resource_tag_assignments_scope_idx" on "booking_resource_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "booking_resource_tag_assignments" add constraint "booking_resource_tag_assignments_unique" unique ("tag_id", "resource_id");`);

    this.addSql(`alter table "booking_resource_tag_assignments" add constraint "booking_resource_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "booking_resource_tags" ("id") on update cascade;`);

    this.addSql(`alter table "booking_resources" drop column "tags";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_resource_tag_assignments" drop constraint "booking_resource_tag_assignments_tag_id_foreign";`);

    this.addSql(`alter table "booking_resources" add column "tags" jsonb not null default '[]';`);
  }

}
