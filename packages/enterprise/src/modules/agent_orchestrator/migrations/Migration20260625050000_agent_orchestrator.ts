import { Migration } from '@mikro-orm/migrations';

// Agent identity & on-behalf-of, Wave 4 Phase 1: the `agent_principals` table
// links an AI agent to its provisioned non-interactive `auth.User` (kind='agent')
// and a scoped `auth.Role` so every agent action is attributed to a concrete user
// id through the same audited Command/CRUD/ACL pipeline as a human. Net-new table
// — no backward-compat concern. Dual tenancy (tenant_id + organization_id);
// reads filter by organization_id. The partial unique index pins one live
// principal per (organization_id, agent_definition_id) so provisioning is
// idempotent, while soft-deleted rows are excluded so a re-provision after
// deletion is allowed.
export class Migration20260625050000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_principals" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "agent_definition_id" varchar(100) not null, "role_id" uuid not null, "credential_mode" varchar(20) not null default 'internal', "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_principals_tenant_org_idx" on "agent_principals" ("tenant_id", "organization_id");`);
    this.addSql(`create index "agent_principals_user_idx" on "agent_principals" ("user_id");`);
    this.addSql(`create unique index "agent_principals_org_agent_uq" on "agent_principals" ("organization_id", "agent_definition_id") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_principals" cascade;`);
  }

}
