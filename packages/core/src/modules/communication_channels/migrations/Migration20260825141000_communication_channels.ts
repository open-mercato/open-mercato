import { Migration } from '@mikro-orm/migrations';

export class Migration20260825141000_communication_channels extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "communication_channels" add column "visibility" text not null default 'private';`);

    // MUST run in the same migration as the column addition.
    //
    // Tenant-scoped channels (`user_id IS NULL`) are shared by definition — that
    // is what "tenant-wide" has always meant, and it is how every existing
    // FCM/APNs/Expo push channel is configured. Landing the column with a bare
    // DEFAULT 'private' would silently un-share all of them on deploy, which is
    // an availability regression, not just a privacy one.
    this.addSql(`update "communication_channels" set "visibility" = 'shared' where "user_id" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "communication_channels" drop column if exists "visibility";`);
  }

}
