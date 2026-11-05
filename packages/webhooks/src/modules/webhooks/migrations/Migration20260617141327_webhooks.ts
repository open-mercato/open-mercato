import { Migration } from '@mikro-orm/migrations';

export class Migration20260617141327_webhooks extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "webhook_inbound_configs" ("id" uuid not null default gen_random_uuid(), "source_key" text not null, "is_active" boolean not null default true, "integration_id" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "webhook_inbound_configs_source_key_is_active_index" on "webhook_inbound_configs" ("source_key", "is_active");`);
    this.addSql(`alter table "webhook_inbound_configs" add constraint "webhook_inbound_configs_source_scope_unique" unique ("source_key", "organization_id", "tenant_id");`);

    this.addSql(`create table "webhook_ingestions" ("id" uuid not null default gen_random_uuid(), "source_key" text not null, "event_type" text not null, "external_message_id" text null, "payload" jsonb not null, "headers" jsonb null, "status" text not null default 'received', "error_message" text null, "processed_at" timestamptz null, "handler_count" int not null default 0, "handler_results" jsonb null, "duration_ms" int null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "webhook_ingestions_external_message_id_index" on "webhook_ingestions" ("external_message_id");`);
    this.addSql(`create index "webhook_ingestions_organization_id_tenant_id_created_at_index" on "webhook_ingestions" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index "webhook_ingestions_source_key_status_created_at_index" on "webhook_ingestions" ("source_key", "status", "created_at");`);
  }

}
