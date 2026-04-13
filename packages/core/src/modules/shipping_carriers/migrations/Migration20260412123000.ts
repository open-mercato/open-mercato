import { Migration } from '@mikro-orm/migrations'

export class Migration20260412123000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "carrier_webhook_events" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "idempotency_key" text not null, "event_type" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "processed_at" timestamptz not null, constraint "carrier_webhook_events_pkey" primary key ("id"));`)
    this.addSql(`alter table "carrier_webhook_events" add constraint "carrier_webhook_events_idempotency_unique" unique ("idempotency_key", "provider_key", "organization_id", "tenant_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "carrier_webhook_events";`)
  }
}
