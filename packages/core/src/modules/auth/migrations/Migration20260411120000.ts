import { Migration } from '@mikro-orm/migrations';

export class Migration20260411120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create extension if not exists "pgcrypto";`);
    this.addSql(`alter table "password_resets" add column "token_hash" text null;`);
    this.addSql(`update "password_resets" set "token_hash" = encode(digest("token", 'sha256'), 'hex') where "token_hash" is null and "token" is not null;`);
    this.addSql(`update "password_resets" set "token" = "token_hash" where "token_hash" is not null;`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_hash_unique" unique ("token_hash");`);
    this.addSql(`create index "password_resets_token_hash_idx" on "password_resets" ("token_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "password_resets_token_hash_idx";`);
    this.addSql(`alter table "password_resets" drop constraint if exists "password_resets_token_hash_unique";`);
    this.addSql(`alter table "password_resets" drop column if exists "token_hash";`);
  }

}
