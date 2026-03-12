import { Migration } from '@mikro-orm/migrations';

export class Migration20260305122155 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "gateway_transactions" ("id" uuid not null default gen_random_uuid(), "payment_id" uuid not null, "provider_key" text not null, "provider_session_id" text null, "gateway_payment_id" text null, "gateway_refund_id" text null, "unified_status" text not null default 'pending', "gateway_status" text null, "redirect_url" text null, "client_secret" text null, "amount" numeric(18,4) not null, "currency_code" text not null, "gateway_metadata" jsonb null, "webhook_log" jsonb null, "last_webhook_at" timestamptz null, "last_polled_at" timestamptz null, "expires_at" timestamptz null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "gateway_transactions_pkey" primary key ("id"));`);
    this.addSql(`create index "gateway_transactions_organization_id_tenant_id_uni_5a9b9_index" on "gateway_transactions" ("organization_id", "tenant_id", "unified_status");`);
    this.addSql(`create index "gateway_transactions_provider_key_provider_session_d8577_index" on "gateway_transactions" ("provider_key", "provider_session_id", "organization_id");`);
    this.addSql(`create index "gateway_transactions_payment_id_organization_id_tenant_id_index" on "gateway_transactions" ("payment_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "gateway_webhook_events" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "idempotency_key" text not null, "event_type" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "processed_at" timestamptz not null, constraint "gateway_webhook_events_pkey" primary key ("id"));`);
    this.addSql(`create unique index "gateway_webhook_events_idempotency_unique" on "gateway_webhook_events" ("idempotency_key", "provider_key", "organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "gateway_webhook_events";`);
    this.addSql(`drop table if exists "gateway_transactions";`);
  }

}
