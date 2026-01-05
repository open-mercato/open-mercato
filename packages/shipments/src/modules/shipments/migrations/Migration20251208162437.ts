import { Migration } from '@mikro-orm/migrations';

export class Migration20251208162437 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipments" drop column "order";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipments" add column "order" varchar(255) null;`);
  }

}
