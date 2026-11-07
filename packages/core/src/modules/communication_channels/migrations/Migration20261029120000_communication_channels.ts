import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

export class Migration20261029120000_communication_channels extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "system_email_deliveries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "status" text not null default 'pending', "attempts" int not null default 0, "recipient" text null, "subject" text null, "html_body" text null, "text_body" text null, "attachments" text null, "from_address" text not null, "from_is_instance_default" boolean not null default false, "reply_to" text null, "provider_key" text null, "last_error" text null, "sent_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "system_email_deliveries_status_idx" on "system_email_deliveries" ("tenant_id", "status", "created_at");`);

    // Existing tenants never receive a map declared after they were created; without this the
    // queued bodies (one-time links) would be written in plaintext for every pre-existing tenant.
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'communication_channels:system_email_delivery',
      fields: [
        { field: 'recipient' },
        { field: 'subject' },
        { field: 'html_body' },
        { field: 'text_body' },
        { field: 'attachments' },
        { field: 'reply_to' },
      ],
    }));
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "system_email_deliveries" cascade;`);
  }

}
