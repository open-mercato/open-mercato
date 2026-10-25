import { Migration } from '@mikro-orm/migrations';

export class Migration20261020120000_dictionaries extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "dictionaries" add column if not exists "key_reserved" boolean generated always as (case when "deleted_at" is null then true end) stored;`);
    this.addSql(`alter table "dictionaries" drop constraint if exists "dictionaries_scope_key_unique";`);
    this.addSql(`alter table "dictionaries" add constraint "dictionaries_scope_key_unique" unique ("organization_id", "tenant_id", "key", "key_reserved");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "dictionaries" drop constraint if exists "dictionaries_scope_key_unique";`);
    this.addSql(`alter table "dictionaries" drop column if exists "key_reserved";`);
    this.addSql(`alter table "dictionaries" add constraint "dictionaries_scope_key_unique" unique ("organization_id", "tenant_id", "key");`);
  }

}
