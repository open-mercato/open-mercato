import { Migration } from '@mikro-orm/migrations';

export class Migration20251223090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "dictionaries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "is_system" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "dictionaries_pkey" primary key ("id"));`);
    this.addSql(`create unique index "dictionaries_scope_key_unique" on "dictionaries" ("organization_id", "tenant_id", "key");`);

    this.addSql(`create table "dictionary_entries" ("id" uuid not null default gen_random_uuid(), "dictionary_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "value" text not null, "normalized_value" text not null, "label" text not null, "color" text null, "icon" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "dictionary_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "dictionary_entries_scope_idx" on "dictionary_entries" ("dictionary_id", "organization_id", "tenant_id");`);
    this.addSql(`create unique index "dictionary_entries_unique" on "dictionary_entries" ("dictionary_id", "organization_id", "tenant_id", "normalized_value");`);

    this.addSql(`alter table "dictionary_entries" add constraint "dictionary_entries_dictionary_id_foreign" foreign key ("dictionary_id") references "dictionaries" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql('alter table "dictionary_entries" drop constraint "dictionary_entries_dictionary_id_foreign";');

    this.addSql('drop table if exists "dictionary_entries" cascade;');
    this.addSql('drop table if exists "dictionaries" cascade;');
  }

}
