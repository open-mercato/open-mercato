import { Migration } from '@mikro-orm/migrations';

export class Migration20260625150049_push_notifications extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "push_notification_deliveries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "notification_id" uuid null, "notification_type_id" text not null, "user_device_id" uuid not null, "user_id" uuid not null, "provider" text not null, "token_snapshot" text not null, "status" text not null default 'pending', "attempts" int not null default 0, "last_error" text null, "payload" jsonb not null, "provider_response" jsonb null, "created_at" timestamptz not null, "sent_at" timestamptz null, "next_retry_at" timestamptz null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "push_notification_deliveries_notification_idx" on "push_notification_deliveries" ("notification_id");`);
    this.addSql(`create index "push_notification_deliveries_tenant_status_idx" on "push_notification_deliveries" ("tenant_id", "status", "created_at");`);
    this.addSql(`create unique index "push_notification_deliveries_notif_device_unique" on "push_notification_deliveries" ("notification_id", "user_device_id") where "notification_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "push_notification_deliveries" cascade;`);
  }

}
