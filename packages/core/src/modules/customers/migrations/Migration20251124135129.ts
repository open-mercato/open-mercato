import { Migration } from '@mikro-orm/migrations';

export class Migration20251124135129 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_addresses" add column "company_name" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_addresses" drop column "company_name";`);
  }

}
