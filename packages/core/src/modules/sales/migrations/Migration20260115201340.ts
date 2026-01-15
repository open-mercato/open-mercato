import { Migration } from '@mikro-orm/migrations';

export class Migration20260115201340 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_acceptance_token_unique";`);
    this.addSql(`alter table "sales_quotes" drop column "acceptance_token", drop column "sent_at";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quotes" add column "acceptance_token" text null, add column "sent_at" timestamptz null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_acceptance_token_unique" unique ("acceptance_token");`);
  }

}
