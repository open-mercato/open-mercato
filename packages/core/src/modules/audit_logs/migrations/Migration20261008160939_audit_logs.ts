import { Migration } from '@mikro-orm/migrations';

// Serves `ActionLogService.scanStateChanges` (Process X-Ray reads undo/redo state changes by
// `updated_at`). Partial, so only undone/redone rows are indexed. action_logs takes a row per
// command, so the index is built CONCURRENTLY (no transaction); dropping first removes an
// INVALID stub left by an interrupted build. Same shape as Migration20261008080138_audit_logs.
export class Migration20261008160939_audit_logs extends Migration {

  override name = 'Migration20261008160939';

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "action_logs_state_change_idx";`);
    this.addSql(`create index concurrently "action_logs_state_change_idx" on "action_logs" ("tenant_id", "organization_id", "updated_at", "id") where "execution_state" in ('undone', 'redone');`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "action_logs_state_change_idx";`);
  }

}
