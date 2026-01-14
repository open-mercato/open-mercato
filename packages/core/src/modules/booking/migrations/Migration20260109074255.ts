import { Migration } from '@mikro-orm/migrations';

export class Migration20260109074255 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "booking_resources" add column "description" text null, add column "appearance_icon" text null, add column "appearance_color" text null;`);

    this.addSql(`alter table "booking_team_members" add column "description" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "booking_resources" drop column "description", drop column "appearance_icon", drop column "appearance_color";`);

    this.addSql(`alter table "booking_team_members" drop column "description";`);
  }

}
