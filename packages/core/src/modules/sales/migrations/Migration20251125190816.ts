import { Migration } from '@mikro-orm/migrations';

export class Migration20251125190816 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_quotes" add column "external_reference" text null, add column "customer_reference" text null, add column "placed_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quotes" drop column "external_reference", drop column "customer_reference", drop column "placed_at";`);
  }

}
