import { Migration } from '@mikro-orm/migrations';

export class Migration20260413061956 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create extension if not exists "pgcrypto";`);

    this.addSql(`alter table "message_access_tokens" drop constraint "message_access_tokens_token_unique";`);
    this.addSql(`drop index "message_access_tokens_token_idx";`);

    this.addSql(`alter table "message_access_tokens" rename column "token" to "token_hash";`);
    this.addSql(`update "message_access_tokens" set "token_hash" = encode(digest("token_hash", 'sha256'), 'hex') where "token_hash" is not null and length("token_hash") <> 64;`);
    this.addSql(`alter table "message_access_tokens" add constraint "message_access_tokens_token_hash_unique" unique ("token_hash");`);
    this.addSql(`create index "message_access_tokens_token_hash_idx" on "message_access_tokens" ("token_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "message_access_tokens" drop constraint "message_access_tokens_token_hash_unique";`);
    this.addSql(`drop index "message_access_tokens_token_hash_idx";`);

    this.addSql(`alter table "message_access_tokens" rename column "token_hash" to "token";`);
    this.addSql(`alter table "message_access_tokens" add constraint "message_access_tokens_token_unique" unique ("token");`);
    this.addSql(`create index "message_access_tokens_token_idx" on "message_access_tokens" ("token");`);
  }

}
