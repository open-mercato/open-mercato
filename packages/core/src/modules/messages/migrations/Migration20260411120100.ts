import { Migration } from '@mikro-orm/migrations';

export class Migration20260411120100 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create extension if not exists "pgcrypto";`);
    this.addSql(`alter table "message_access_tokens" add column "token_hash" text null;`);
    this.addSql(`update "message_access_tokens" set "token_hash" = encode(digest("token", 'sha256'), 'hex') where "token_hash" is null and "token" is not null;`);
    this.addSql(`update "message_access_tokens" set "token" = "token_hash" where "token_hash" is not null;`);
    this.addSql(`alter table "message_access_tokens" add constraint "message_access_tokens_token_hash_unique" unique ("token_hash");`);
    this.addSql(`create index "message_access_tokens_token_hash_idx" on "message_access_tokens" ("token_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "message_access_tokens_token_hash_idx";`);
    this.addSql(`alter table "message_access_tokens" drop constraint if exists "message_access_tokens_token_hash_unique";`);
    this.addSql(`alter table "message_access_tokens" drop column if exists "token_hash";`);
  }

}
