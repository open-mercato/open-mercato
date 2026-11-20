import { Migration } from '@mikro-orm/migrations';

export class Migration20261120120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column if not exists "scheduled_at" timestamptz null, add column if not exists "scheduled_release_attempts" int not null default 0, add column if not exists "sender_channel_id" uuid null;`);
    this.addSql(`create index if not exists "messages_scheduled_release_idx" on "messages" ("tenant_id", "organization_id", "scheduled_at") where "status" = 'scheduled';`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "messages_scheduled_release_idx";`);
    this.addSql(`alter table "messages" drop column if exists "scheduled_at", drop column if exists "scheduled_release_attempts", drop column if exists "sender_channel_id";`);
  }

}
