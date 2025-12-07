import { Migration } from '@mikro-orm/migrations';

export class Migration20251127172452 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_shipping_methods" add column "provider_key" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_shipping_methods" drop column "provider_key";`);
  }

}
