import { Migration } from '@mikro-orm/migrations';

export class Migration20251209080326 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "email_hash" text null;`);
    this.addSql(`create index "users_email_hash_idx" on "users" ("email_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "users_email_hash_idx";`);
    this.addSql(`alter table "users" drop column "email_hash";`);
  }

}
