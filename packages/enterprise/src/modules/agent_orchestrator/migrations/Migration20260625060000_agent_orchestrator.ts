import { Migration } from '@mikro-orm/migrations';

// Agent identity & on-behalf-of, Wave 4 Phase 3 (external OAuth + no-bypass): the
// `agent_delegation_grants` table links an external agent principal
// (credential_mode='oauth_client') to the human delegator + the scopes it may mint
// OAuth client-credentials tokens for. It is the per-request REVOCATION spine —
// the `/token` server refuses to mint while a non-null `revoked_at` (or a past
// `expires_at`) is set, and every minted token re-checks the grant on the NEXT
// request, so revoking stops further agent action immediately rather than at token
// expiry. Net-new table — no backward-compat concern. Dual tenancy (tenant_id +
// organization_id); reads filter by organization_id. The issuer/subject/audience
// columns are forward-compatible seams for the later auth.md/ID-JAG path (Phase 4).
export class Migration20260625060000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_delegation_grants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_principal_id" uuid not null, "agent_user_id" uuid not null, "delegator_user_id" uuid null, "scopes" jsonb not null, "expires_at" timestamptz null, "revoked_at" timestamptz null, "revoked_by_user_id" uuid null, "issuer" varchar(500) null, "subject" varchar(500) null, "audience" varchar(500) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "agent_delegation_grants_tenant_org_idx" on "agent_delegation_grants" ("tenant_id", "organization_id");`);
    this.addSql(`create index "agent_delegation_grants_principal_idx" on "agent_delegation_grants" ("organization_id", "agent_principal_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_delegation_grants" cascade;`);
  }

}
