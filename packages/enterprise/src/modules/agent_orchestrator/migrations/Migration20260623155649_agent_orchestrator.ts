import { Migration } from '@mikro-orm/migrations';

export class Migration20260623155649_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_eval_assertions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "key" varchar(100) not null, "title" varchar(200) not null, "description" text null, "applies_to" varchar(100) not null, "type" varchar(20) not null, "severity" varchar(20) not null, "config" jsonb null, "version" int not null default 1, "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_assertions_applies_idx" on "agent_eval_assertions" ("organization_id", "applies_to", "enabled");`);
    this.addSql(`create index "agent_eval_assertions_tenant_org_idx" on "agent_eval_assertions" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_eval_assertions" add constraint "agent_eval_assertions_key_uq" unique ("organization_id", "applies_to", "key");`);

    this.addSql(`create table "agent_eval_results" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_run_id" uuid not null, "assertion_id" uuid not null, "assertion_key" varchar(100) not null, "passed" boolean not null, "score" real null, "severity" varchar(20) not null, "evidence" jsonb null, "evaluated_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_eval_results_assertion_idx" on "agent_eval_results" ("assertion_id");`);
    this.addSql(`create index "agent_eval_results_run_idx" on "agent_eval_results" ("agent_run_id");`);
    this.addSql(`create index "agent_eval_results_tenant_org_idx" on "agent_eval_results" ("tenant_id", "organization_id");`);
  }

}
