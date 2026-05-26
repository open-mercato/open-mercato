import { Migration } from '@mikro-orm/migrations';

export class Migration20260417120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column if not exists "external_email_hash" text null;`);
    this.addSql(`create index if not exists "messages_external_email_hash_idx" on "messages" ("external_email_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "messages_external_email_hash_idx";`);
    this.addSql(`alter table "messages" drop column if exists "external_email_hash";`);
  }

}
