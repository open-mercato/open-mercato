import { Migration } from '@mikro-orm/migrations'

export class Migration20260508170000_ai_token_usage extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table "ai_token_usage_events" (
        "id" uuid not null default gen_random_uuid(),
        "tenant_id" uuid not null,
        "organization_id" uuid null,
        "user_id" uuid not null,
        "agent_id" text not null,
        "module_id" text not null,
        "session_id" uuid not null,
        "turn_id" uuid not null,
        "step_index" int not null,
        "provider_id" text not null,
        "model_id" text not null,
        "input_tokens" int not null,
        "output_tokens" int not null,
        "cached_input_tokens" int null,
        "reasoning_tokens" int null,
        "finish_reason" text null,
        "loop_abort_reason" text null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "ai_token_usage_events_pkey" primary key ("id")
      );
    `)
    this.addSql(`
      create index "ai_token_usage_events_tenant_created_idx"
        on "ai_token_usage_events" ("tenant_id", "created_at" desc);
    `)
    this.addSql(`
      create index "ai_token_usage_events_tenant_agent_created_idx"
        on "ai_token_usage_events" ("tenant_id", "agent_id", "created_at" desc);
    `)
    this.addSql(`
      create index "ai_token_usage_events_tenant_model_created_idx"
        on "ai_token_usage_events" ("tenant_id", "model_id", "created_at" desc);
    `)
    this.addSql(`
      create index "ai_token_usage_events_tenant_session_turn_step_idx"
        on "ai_token_usage_events" ("tenant_id", "session_id", "turn_id", "step_index");
    `)

    this.addSql(`
      create table "ai_token_usage_daily" (
        "id" uuid not null default gen_random_uuid(),
        "tenant_id" uuid not null,
        "organization_id" uuid null,
        "day" date not null,
        "agent_id" text not null,
        "model_id" text not null,
        "provider_id" text not null,
        "input_tokens" bigint not null default 0,
        "output_tokens" bigint not null default 0,
        "cached_input_tokens" bigint not null default 0,
        "reasoning_tokens" bigint not null default 0,
        "step_count" bigint not null default 0,
        "turn_count" bigint not null default 0,
        "session_count" bigint not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "ai_token_usage_daily_pkey" primary key ("id")
      );
    `)
    this.addSql(`
      create unique index "ai_token_usage_daily_tenant_day_agent_model_org_uq"
        on "ai_token_usage_daily" ("tenant_id", "day", "agent_id", "model_id", "organization_id")
        where "organization_id" is not null;
    `)
    this.addSql(`
      create unique index "ai_token_usage_daily_tenant_day_agent_model_null_org_uq"
        on "ai_token_usage_daily" ("tenant_id", "day", "agent_id", "model_id")
        where "organization_id" is null;
    `)
    this.addSql(`
      create index "ai_token_usage_daily_tenant_day_idx"
        on "ai_token_usage_daily" ("tenant_id", "day");
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_token_usage_events" cascade;`)
    this.addSql(`drop table if exists "ai_token_usage_daily" cascade;`)
  }

}
