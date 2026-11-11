import { Migration } from '@mikro-orm/migrations';

export class Migration20261111171228_messages extends Migration {

  override name = 'Migration20261111171228';

  override up(): void | Promise<void> {
    this.addSql(`create table "message_external_recipient_days" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "utc_day" text not null, "recipient_hash" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "message_external_recipient_days" add constraint "message_external_recipient_days_unique" unique ("tenant_id", "utc_day", "recipient_hash");`);
  }

}
