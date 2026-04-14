import { Migration } from '@mikro-orm/migrations';

export class Migration20260413061956 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create extension if not exists "pgcrypto";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_acceptance_token_unique";`);

    this.addSql(`alter table "sales_quotes" rename column "acceptance_token" to "acceptance_token_hash";`);
    this.addSql(`update "sales_quotes" set "acceptance_token_hash" = encode(digest("acceptance_token_hash", 'sha256'), 'hex') where "acceptance_token_hash" is not null and length("acceptance_token_hash") <> 64;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_acceptance_token_hash_unique" unique ("acceptance_token_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_acceptance_token_hash_unique";`);

    this.addSql(`alter table "sales_quotes" rename column "acceptance_token_hash" to "acceptance_token";`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_acceptance_token_unique" unique ("acceptance_token");`);
  }

}
