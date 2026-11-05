import { Migration } from '@mikro-orm/migrations';

export class Migration20251201183633 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_notes" add column "appearance_icon" text null, add column "appearance_color" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_notes" drop column "appearance_icon", drop column "appearance_color";`);
  }

}
