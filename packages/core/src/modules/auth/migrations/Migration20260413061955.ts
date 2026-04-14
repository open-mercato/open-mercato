import { Migration } from '@mikro-orm/migrations';

export class Migration20260413061955 extends Migration {

  override async up(): Promise<void> {
    // Ensure pgcrypto is available for digest(); idempotent.
    this.addSql(`create extension if not exists "pgcrypto";`);

    this.addSql(`alter table "sessions" drop constraint "sessions_token_unique";`);
    this.addSql(`alter table "sessions" rename column "token" to "token_hash";`);
    // Hash existing plaintext tokens in place so active sessions keep working.
    this.addSql(`update "sessions" set "token_hash" = encode(digest("token_hash", 'sha256'), 'hex') where "token_hash" is not null and length("token_hash") <> 64;`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_hash_unique" unique ("token_hash");`);

    this.addSql(`alter table "password_resets" drop constraint "password_resets_token_unique";`);
    this.addSql(`alter table "password_resets" rename column "token" to "token_hash";`);
    this.addSql(`update "password_resets" set "token_hash" = encode(digest("token_hash", 'sha256'), 'hex') where "token_hash" is not null and length("token_hash") <> 64;`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_hash_unique" unique ("token_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sessions" drop constraint "sessions_token_hash_unique";`);

    this.addSql(`alter table "sessions" rename column "token_hash" to "token";`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_unique" unique ("token");`);

    this.addSql(`alter table "password_resets" drop constraint "password_resets_token_hash_unique";`);

    this.addSql(`alter table "password_resets" rename column "token_hash" to "token";`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_unique" unique ("token");`);
  }

}
