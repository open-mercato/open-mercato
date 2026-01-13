import { Migration } from '@mikro-orm/migrations';

export class Migration20260110071729 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "booking_resources" drop column "is_available_by_default";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_resources" add column "is_available_by_default" boolean not null default true;`);
  }

}
