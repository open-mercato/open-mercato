import { Migration } from '@mikro-orm/migrations';

export class Migration20251030150038 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "example_items" ("id" uuid not null default gen_random_uuid(), "title" text not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "example_items_pkey" primary key ("id"));`);

    this.addSql(`create table "todos" ("id" uuid not null default gen_random_uuid(), "title" text not null, "tenant_id" uuid null, "organization_id" uuid null, "is_done" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "todos_pkey" primary key ("id"));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "example_items" cascade;`);

    this.addSql(`drop table if exists "todos" cascade;`);
  }

}
