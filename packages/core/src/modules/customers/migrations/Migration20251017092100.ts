import { Migration } from '@mikro-orm/migrations';

export class Migration20251017092100 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_dictionary_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "value" text not null, "normalized_value" text not null, "label" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_dictionary_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_dictionary_entries_scope_idx" on "customer_dictionary_entries" ("organization_id", "tenant_id", "kind");`);
    this.addSql(`alter table "customer_dictionary_entries" add constraint "customer_dictionary_entries_unique" unique ("organization_id", "tenant_id", "kind", "normalized_value");`);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "customer_dictionary_entries" cascade;');
  }

}
