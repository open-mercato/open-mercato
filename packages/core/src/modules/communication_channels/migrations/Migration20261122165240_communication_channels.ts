import { Migration } from '@mikro-orm/migrations';

export class Migration20261122165240_communication_channels extends Migration {

  override name = 'Migration20261122165240';

  override up(): void | Promise<void> {
    this.addSql(`create table "communication_channel_folder_cursors" ("id" uuid not null default gen_random_uuid(), "channel_id" uuid not null, "folder_id" text collate "C" not null, "cursor" text not null, "version" uuid not null default gen_random_uuid(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "communication_channel_folder_cursors" add constraint "communication_channel_folder_cursors_channel_folder_uq" unique ("channel_id", "folder_id");`);

    this.addSql(`alter table "communication_channel_folder_cursors" add constraint "communication_channel_folder_cursors_channel_id_foreign" foreign key ("channel_id") references "communication_channels" ("id") on delete cascade;`);
  }

  override down(): void {
    this.addSql(`drop table "communication_channel_folder_cursors";`);
  }

}
