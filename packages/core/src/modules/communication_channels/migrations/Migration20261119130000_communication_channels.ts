import { Migration } from '@mikro-orm/migrations';

export class Migration20261119130000_communication_channels extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "message_channel_links" add column if not exists "external_participant_id" uuid null;`);
    this.addSql(`alter table "message_channel_links" drop constraint if exists "message_channel_links_message_uq";`);
    this.addSql(`create unique index if not exists "message_channel_links_message_joint_uq" on "message_channel_links" ("message_id") where "external_participant_id" is null;`);
    this.addSql(`create unique index if not exists "message_channel_links_message_participant_uq" on "message_channel_links" ("message_id", "external_participant_id") where "external_participant_id" is not null;`);
  }

  override async down(): Promise<void> {
    // Separate-send rows have no place under the restored one-link-per-message rule.
    this.addSql(`delete from "message_channel_links" where "external_participant_id" is not null;`);
    this.addSql(`drop index if exists "message_channel_links_message_participant_uq";`);
    this.addSql(`drop index if exists "message_channel_links_message_joint_uq";`);
    this.addSql(`alter table "message_channel_links" add constraint "message_channel_links_message_uq" unique ("message_id");`);
    this.addSql(`alter table "message_channel_links" drop column if exists "external_participant_id";`);
  }

}
