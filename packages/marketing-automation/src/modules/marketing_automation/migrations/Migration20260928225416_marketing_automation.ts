import { Migration } from '@mikro-orm/migrations';

export class Migration20260928225416_marketing_automation extends Migration {

  override name = 'Migration20260928225416';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_campaign_revisions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid not null, "version" int not null, "name" text not null, "definition" jsonb not null, "triggers" jsonb not null, "actor_id" text null, "note" text not null, "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_revisions_campaign_idx" on "marketing_campaign_revisions" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`alter table "marketing_campaign_revisions" add constraint "marketing_revisions_version_uniq" unique ("tenant_id", "organization_id", "campaign_id", "version");`);

    this.addSql(`create table "marketing_job_runs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "campaign_id" uuid null, "started_at" timestamptz not null default now(), "finished_at" timestamptz null, "status" text not null default 'running', "counters" jsonb null, "error" text null, primary key ("id"));`);
    this.addSql(`create index "mkt_job_runs_kind_idx" on "marketing_job_runs" ("tenant_id", "organization_id", "kind", "started_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_campaign_revisions" cascade;`);
    this.addSql(`drop table if exists "marketing_job_runs" cascade;`);
  }

}
