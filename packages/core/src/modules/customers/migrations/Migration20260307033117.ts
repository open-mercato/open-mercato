import { Migration } from '@mikro-orm/migrations';

export class Migration20260307033117 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_saved_views" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "user_id" uuid not null, "entity_type" text not null, "name" text not null, "filters" jsonb not null default '{}', "sort_field" text null, "sort_dir" text null, "columns" jsonb null, "is_default" boolean not null default false, "is_shared" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "customer_saved_views_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_saved_views_org_idx" on "customer_saved_views" ("organization_id", "tenant_id", "entity_type", "is_shared");`);
    this.addSql(`create index "customer_saved_views_user_idx" on "customer_saved_views" ("user_id", "entity_type");`);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "customer_saved_views" cascade;');
  }

}
