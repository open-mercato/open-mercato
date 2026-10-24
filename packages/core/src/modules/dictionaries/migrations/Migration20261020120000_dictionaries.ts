import { Migration } from '@mikro-orm/migrations';

export class Migration20261020120000_dictionaries extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "dictionaries" drop constraint if exists "dictionaries_scope_key_unique";`);
    this.addSql(`create unique index "dictionaries_scope_key_unique" on "dictionaries" ("organization_id", "tenant_id", "key") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "dictionaries_scope_key_unique";`);
    this.addSql(`alter table "dictionaries" add constraint "dictionaries_scope_key_unique" unique ("organization_id", "tenant_id", "key");`);
  }

}
