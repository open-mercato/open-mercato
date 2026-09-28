import { Migration } from '@mikro-orm/migrations';

export class Migration20260928205253_marketing_automation extends Migration {

  override name = 'Migration20260928205253';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_consents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "channel" text not null, "state" text not null, "reason" text null, "source" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_consents" add constraint "marketing_consents_subject_channel_uniq" unique ("tenant_id", "organization_id", "subject_entity_id", "channel");`);

    this.addSql(`create table "marketing_consent_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "channel" text not null, "state" text not null, "reason" text null, "source" text not null, "campaign_id" uuid null, "occurred_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_consent_events_subject_idx" on "marketing_consent_events" ("tenant_id", "organization_id", "subject_entity_id");`);
  }
  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_consent_events" cascade;`);
    this.addSql(`drop table if exists "marketing_consents" cascade;`);
  }

}
