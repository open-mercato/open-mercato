import { Migration } from '@mikro-orm/migrations';

// rule_execution_logs is written by the wildcard CRUD rule trigger on every matching
// event, so the run-id index is built CONCURRENTLY outside a transaction instead of
// holding a SHARE lock for the whole build. Dropping first recovers from an INVALID stub
// left by an interrupted concurrent build. Same shape as catalog/Migration20260914120100.
export class Migration20261008080138_business_rules extends Migration {

  override name = 'Migration20261008080138';

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "rule_execution_logs_run_idx";`);
    this.addSql(`create index concurrently "rule_execution_logs_run_idx" on "rule_execution_logs" ("tenant_id", "run_id") where "run_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "rule_execution_logs_run_idx";`);
  }

}
