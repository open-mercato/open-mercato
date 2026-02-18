import { Migration } from '@mikro-orm/migrations';

export class Migration20260218180716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "notifications" ("id" uuid not null default gen_random_uuid(), "recipient_user_id" uuid not null, "type" text not null, "title_key" text null, "body_key" text null, "title_variables" jsonb null, "body_variables" jsonb null, "title" text not null, "body" text null, "icon" text null, "severity" text not null default 'info', "status" text not null default 'unread', "action_data" jsonb null, "action_result" jsonb null, "action_taken" text null, "source_module" text null, "source_entity_type" text null, "source_entity_id" uuid null, "link_href" text null, "group_key" text null, "created_at" timestamptz not null, "read_at" timestamptz null, "actioned_at" timestamptz null, "dismissed_at" timestamptz null, "expires_at" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid null, constraint "notifications_pkey" primary key ("id"));`);
    this.addSql(`create index "notifications_group_idx" on "notifications" ("group_key", "recipient_user_id");`);
    this.addSql(`create index "notifications_expires_idx" on "notifications" ("expires_at");`);
    this.addSql(`create index "notifications_tenant_idx" on "notifications" ("tenant_id", "organization_id");`);
    this.addSql(`create index "notifications_source_idx" on "notifications" ("source_entity_type", "source_entity_id");`);
    this.addSql(`create index "notifications_recipient_status_idx" on "notifications" ("recipient_user_id", "status", "created_at");`);
  }

}
