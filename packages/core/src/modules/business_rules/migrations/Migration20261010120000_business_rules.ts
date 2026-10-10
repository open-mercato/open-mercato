import { Migration } from '@mikro-orm/migrations';

// Serves the Change Simulator's observed tier, which pages one organization's run-tagged
// rule_execution_logs rows for an entity type by (executed_at, id). The table is written by the
// wildcard CRUD rule trigger on every matching event, so the index is built CONCURRENTLY outside
// a transaction instead of holding a SHARE lock for the whole build. Dropping first recovers from
// an INVALID stub left by an interrupted concurrent build. Same shape as Migration20261008080138.
export class Migration20261010120000_business_rules extends Migration {

  override name = 'Migration20261010120000';

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "rule_execution_logs_simulation_idx";`);
    this.addSql(`create index concurrently "rule_execution_logs_simulation_idx" on "rule_execution_logs" ("tenant_id", "organization_id", "entity_type", "executed_at") where "run_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "rule_execution_logs_simulation_idx";`);
  }

}
