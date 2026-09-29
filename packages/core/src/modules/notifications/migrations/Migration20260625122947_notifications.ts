import { Migration } from '@mikro-orm/migrations';

export class Migration20260625122947_notifications extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "notification_preferences" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "user_id" uuid not null, "notification_type_id" text not null, "channel" text not null, "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "notification_preferences_unique" on "notification_preferences" ("tenant_id", "user_id", "notification_type_id", "channel");`);
    this.addSql(`create index "notification_preferences_tenant_user_idx" on "notification_preferences" ("tenant_id", "user_id");`);

    this.addSql(`create table "notification_types" ("id" text not null, "tenant_id" uuid null, "label_key" text not null, "description_key" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "notification_types_tenant_idx" on "notification_types" ("tenant_id");`);
  }

}
