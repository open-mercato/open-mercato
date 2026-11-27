import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

export class Migration20261119120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column if not exists "email_send_separately" boolean not null default false;`);

    this.addSql(`create table if not exists "message_external_participants" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "role" text not null, "email" text not null, "email_hash" text not null, "name" text null, "delivery_status" text null, "delivery_error" text null, "next_attempt_at" timestamptz null, "sent_at" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "message_external_participants_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "message_external_participants_message_idx" on "message_external_participants" ("message_id");`);
    this.addSql(`create index if not exists "message_external_participants_email_hash_idx" on "message_external_participants" ("tenant_id", "organization_id", "email_hash");`);
    this.addSql(`create index if not exists "message_external_participants_pending_idx" on "message_external_participants" ("next_attempt_at") where "delivery_status" = 'pending';`);
    this.addSql(`alter table "message_external_participants" add constraint "message_external_participants_message_role_email_unique" unique ("message_id", "role", "email_hash");`);
    this.addSql(`alter table "message_external_participants" add constraint "message_external_participants_message_id_foreign" foreign key ("message_id") references "messages" ("id") on delete cascade;`);

    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'messages:message_external_participant',
      fields: [{ field: 'email', hashField: 'email_hash' }, { field: 'name' }],
    }));
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "message_external_participants" cascade;`);
    this.addSql(`alter table "messages" drop column if exists "email_send_separately";`);
  }

}
