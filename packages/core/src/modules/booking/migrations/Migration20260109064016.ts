import { Migration } from '@mikro-orm/migrations';

export class Migration20260109064016 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "booking_resource_types" add column "appearance_icon" text null, add column "appearance_color" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_resource_types" drop column "appearance_icon", drop column "appearance_color";`);
  }

}
