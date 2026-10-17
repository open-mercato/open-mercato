import { Migration } from '@mikro-orm/migrations';

// action_logs receives a row for every command, so a plain CREATE INDEX would hold its
// SHARE lock and block every audited write for the whole build. The causation indexes
// are therefore built CONCURRENTLY, which cannot run inside a transaction. Dropping first
// lets a retried deploy remove an INVALID stub left by an interrupted concurrent build.
// Same shape as catalog/Migration20260914120100.
export class Migration20261008080138_audit_logs extends Migration {

  override name = 'Migration20261008080138';

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "action_logs_cause_idx";`);
    this.addSql(`create index concurrently "action_logs_cause_idx" on "action_logs" ("tenant_id", "cause_kind", "cause_id", "created_at");`);
    this.addSql(`drop index concurrently if exists "action_logs_correlation_idx";`);
    this.addSql(`create index concurrently "action_logs_correlation_idx" on "action_logs" ("tenant_id", "correlation_id");`);
    this.addSql(`drop index concurrently if exists "action_logs_caused_by_idx";`);
    this.addSql(`create index concurrently "action_logs_caused_by_idx" on "action_logs" ("caused_by_log_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "action_logs_caused_by_idx";`);
    this.addSql(`drop index concurrently if exists "action_logs_correlation_idx";`);
    this.addSql(`drop index concurrently if exists "action_logs_cause_idx";`);
  }

}
