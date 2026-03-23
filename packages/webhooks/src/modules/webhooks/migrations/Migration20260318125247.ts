import { Migration } from '@mikro-orm/migrations';

export class Migration20260318125247 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "webhook_deliveries" ("id" uuid not null default gen_random_uuid(), "webhook_id" uuid not null, "event_type" text not null, "message_id" text not null, "payload" jsonb not null, "status" text not null default 'pending', "response_status" int null, "response_body" text null, "response_headers" jsonb null, "error_message" text null, "attempt_number" int not null default 0, "max_attempts" int not null default 10, "next_retry_at" timestamptz null, "duration_ms" int null, "target_url" text not null, "enqueued_at" timestamptz not null, "last_attempt_at" timestamptz null, "delivered_at" timestamptz null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "webhook_deliveries_pkey" primary key ("id"));`);
    this.addSql(`create index "webhook_deliveries_event_type_organization_id_index" on "webhook_deliveries" ("event_type", "organization_id");`);
    this.addSql(`create index "webhook_deliveries_webhook_id_created_at_index" on "webhook_deliveries" ("webhook_id", "created_at");`);
    this.addSql(`create index "webhook_deliveries_organization_id_tenant_id_created_at_index" on "webhook_deliveries" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index "webhook_deliveries_webhook_id_status_index" on "webhook_deliveries" ("webhook_id", "status");`);

    this.addSql(`create table "webhooks" ("id" uuid not null default gen_random_uuid(), "name" text not null, "description" text null, "url" text not null, "secret" text not null, "previous_secret" text null, "previous_secret_set_at" timestamptz null, "subscribed_events" jsonb not null, "http_method" text not null default 'POST', "custom_headers" jsonb null, "is_active" boolean not null default true, "delivery_strategy" text not null default 'http', "strategy_config" jsonb null, "max_retries" int not null default 10, "timeout_ms" int not null default 15000, "rate_limit_per_minute" int not null default 0, "consecutive_failures" int not null default 0, "auto_disable_threshold" int not null default 100, "last_success_at" timestamptz null, "last_failure_at" timestamptz null, "integration_id" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "webhooks_pkey" primary key ("id"));`);
    this.addSql(`create index "webhooks_organization_id_tenant_id_deleted_at_index" on "webhooks" ("organization_id", "tenant_id", "deleted_at");`);
    this.addSql(`create index "webhooks_organization_id_tenant_id_is_active_index" on "webhooks" ("organization_id", "tenant_id", "is_active");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "webhook_deliveries";`);
    this.addSql(`drop table if exists "webhooks";`);
  }

}
