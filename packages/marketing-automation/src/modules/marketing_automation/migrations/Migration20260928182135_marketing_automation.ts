import { Migration } from '@mikro-orm/migrations';

export class Migration20260928182135_marketing_automation extends Migration {

  override name = 'Migration20260928182135';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_message_send_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid not null, "run_id" uuid not null, "step_id" text not null, "send_id" uuid null, "type" text not null, "link_url" text null, "occurred_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_send_events_send_idx" on "marketing_message_send_events" ("send_id", "type");`);
    this.addSql(`create index "mkt_send_events_run_step_idx" on "marketing_message_send_events" ("tenant_id", "organization_id", "run_id", "step_id");`);
    this.addSql(`create index "mkt_send_events_campaign_idx" on "marketing_message_send_events" ("tenant_id", "organization_id", "campaign_id", "type");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_message_send_events" cascade;`);
  }

}
