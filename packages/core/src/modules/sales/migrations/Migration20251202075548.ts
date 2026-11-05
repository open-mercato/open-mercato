import { Migration } from '@mikro-orm/migrations';

export class Migration20251202075548 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_shipments" add column "items_snapshot" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_shipments" drop column "items_snapshot";`);
  }

}
