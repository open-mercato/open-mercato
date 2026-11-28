import { Migration } from '@mikro-orm/migrations';

export class Migration20261111210148_messages extends Migration {

  override name = 'Migration20261111210148';

  override up(): void | Promise<void> {
    this.addSql(`create table "message_external_email_windows" ("id" uuid not null default gen_random_uuid(), "scope" text not null, "tenant_id" uuid not null, "subject_id" uuid not null, "window_start" int not null, "count" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "message_external_email_windows" add constraint "message_external_email_windows_unique" unique ("scope", "tenant_id", "subject_id", "window_start");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "message_external_email_windows";`);
  }

}
