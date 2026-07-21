import { Migration } from '@mikro-orm/migrations';

export class Migration20260716123121_notifications extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "notification_type_overrides" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "notification_type_id" text not null, "channels" jsonb null, "non_opt_out" boolean null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "notification_type_overrides_unique" on "notification_type_overrides" ("tenant_id", "notification_type_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "notification_type_overrides" cascade;`);
  }

}
