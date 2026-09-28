import { Migration } from '@mikro-orm/migrations';

export class Migration20260928185410_marketing_automation extends Migration {

  override name = 'Migration20260928185410';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_customer_score_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "points" int not null, "reason" text null, "source" text not null, "campaign_id" uuid null, "run_id" uuid null, "step_id" text null, "occurred_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create unique index "marketing_score_entry_step_uniq" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "run_id", "step_id") where run_id is not null;`);
    this.addSql(`create index "mkt_score_campaign_idx" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`create index "mkt_score_subject_idx" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "subject_entity_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_customer_score_entries" cascade;`);
  }

}
