import { Migration } from '@mikro-orm/migrations';

export class Migration20260713175446_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_settings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "icon" varchar(64) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_settings_tenant_org_idx" on "agent_settings" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "agent_settings" add constraint "agent_settings_org_agent_uq" unique ("tenant_id", "organization_id", "agent_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_settings";`);
  }

}
