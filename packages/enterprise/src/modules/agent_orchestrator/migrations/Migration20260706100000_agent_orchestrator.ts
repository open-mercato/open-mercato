import { Migration } from '@mikro-orm/migrations';

// Performance hardening Phase 3 (index-only, additive): composite indexes for
// the two hottest operator queries — Caseload's disposition-filtered proposal
// list and the runs status facet, both ordered by created_at — plus a partial
// index for the eval-failed facet (tiny: only rows with eval_passed = false).
// The composite indexes are decorator-declared on AgentRun/AgentProposal; the
// partial index uses an @Index({ expression }) on AgentRun so the schema
// differ tracks it. All statements are idempotent (`if not exists`) so
// environments that pre-created them CONCURRENTLY are unaffected.
export class Migration20260706100000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index if not exists "agent_runs_org_status_created_idx" on "agent_runs" ("organization_id", "status", "created_at");`);
    this.addSql(`create index if not exists "agent_proposals_org_disposition_created_idx" on "agent_proposals" ("organization_id", "disposition", "created_at");`);
    this.addSql(`create index if not exists "agent_runs_eval_failed_idx" on "agent_runs" ("organization_id", "created_at") where "eval_passed" = false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "agent_runs_org_status_created_idx";`);
    this.addSql(`drop index if exists "agent_proposals_org_disposition_created_idx";`);
    this.addSql(`drop index if exists "agent_runs_eval_failed_idx";`);
  }

}
