import { Migration } from '@mikro-orm/migrations';

export class Migration20260411103551 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_entities" add column "temperature" text null, add column "renewal_quarter" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_entities" drop column "temperature", drop column "renewal_quarter";`);
  }

}
