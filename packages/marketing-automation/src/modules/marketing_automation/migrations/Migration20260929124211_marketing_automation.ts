import { Migration } from '@mikro-orm/migrations';

export class Migration20260929124211_marketing_automation extends Migration {

  override name = 'Migration20260929124211';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_score_rules" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "description" text null, "expression" jsonb null, "points" int not null, "is_enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_score_rules_scope_idx" on "marketing_score_rules" ("tenant_id", "organization_id", "deleted_at");`);

    this.addSql(`alter table "marketing_customer_score_entries" add "rule_sequence" int null;`);
    this.addSql(`create unique index "marketing_score_entry_rule_seq_uniq" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "subject_entity_id", "rule_sequence") where rule_sequence is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "marketing_score_entry_rule_seq_uniq";`);
    this.addSql(`alter table "marketing_customer_score_entries" drop column "rule_sequence";`);
    this.addSql(`drop table if exists "marketing_score_rules" cascade;`);
  }

}
