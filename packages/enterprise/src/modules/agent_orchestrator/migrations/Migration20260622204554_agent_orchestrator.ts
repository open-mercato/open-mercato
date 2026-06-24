import { Migration } from '@mikro-orm/migrations';

export class Migration20260622204554_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_run_sessions" ("id" uuid not null default gen_random_uuid(), "session_token" varchar(100) not null, "agent_id" varchar(100) not null, "run_id" uuid null, "tenant_id" uuid not null, "organization_id" uuid not null, "outcome" jsonb null, "status" varchar(20) not null default 'pending', "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "agent_run_sessions" add constraint "agent_run_sessions_session_token_unique" unique ("session_token");`);
    this.addSql(`create index "agent_run_sessions_token_idx" on "agent_run_sessions" ("session_token");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_run_sessions" cascade;`);
  }

}
