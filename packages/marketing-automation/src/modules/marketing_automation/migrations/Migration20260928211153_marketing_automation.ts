import { Migration } from '@mikro-orm/migrations';

export class Migration20260928211153_marketing_automation extends Migration {

  override name = 'Migration20260928211153';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_survey_prompts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid null, "campaign_id" uuid not null, "run_id" uuid not null, "step_id" text not null, "question" text not null, "score" int null, "comment" text null, "asked_at" timestamptz not null default now(), "answered_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_survey_campaign_idx" on "marketing_survey_prompts" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`create index "mkt_survey_subject_idx" on "marketing_survey_prompts" ("tenant_id", "organization_id", "subject_entity_id");`);
    this.addSql(`alter table "marketing_survey_prompts" add constraint "marketing_survey_prompts_step_uniq" unique ("tenant_id", "organization_id", "run_id", "step_id");`);
  }
  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_survey_prompts" cascade;`);
  }

}
