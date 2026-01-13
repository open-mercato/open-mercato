import { Migration } from '@mikro-orm/migrations';

export class Migration20260108160800 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "booking_resources" add column "capacity_unit_value" text null, add column "capacity_unit_name" text null, add column "capacity_unit_color" text null, add column "capacity_unit_icon" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_resources" drop column "capacity_unit_value", drop column "capacity_unit_name", drop column "capacity_unit_color", drop column "capacity_unit_icon";`);
  }

}
