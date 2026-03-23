import { Migration } from '@mikro-orm/migrations';

export class Migration20260323132233 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "webhook_inbound_receipts" ("id" uuid not null default gen_random_uuid(), "endpoint_id" text not null, "message_id" text not null, "provider_key" text not null, "event_type" text null, "organization_id" uuid null, "tenant_id" uuid null, "created_at" timestamptz not null, constraint "webhook_inbound_receipts_pkey" primary key ("id"));`);
    this.addSql(`create index "webhook_inbound_receipts_provider_key_created_at_index" on "webhook_inbound_receipts" ("provider_key", "created_at");`);
    this.addSql(`alter table "webhook_inbound_receipts" add constraint "webhook_inbound_receipts_endpoint_message_unique" unique ("endpoint_id", "message_id");`);
  }

}
