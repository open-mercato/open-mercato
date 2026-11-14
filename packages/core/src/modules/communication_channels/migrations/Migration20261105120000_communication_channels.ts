import { Migration } from '@mikro-orm/migrations';

export class Migration20261105120000_communication_channels extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "communication_channels" add column "connected_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "communication_channels" drop column if exists "connected_at";`);
  }

}
