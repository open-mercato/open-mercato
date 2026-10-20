import { Migration } from '@mikro-orm/migrations';

// Serves `ActionLogService.scanDecrypted` (Process X-Ray walks one organization's live rows in
// `(created_at, id)` keyset order). Partial, so soft-deleted rows are not indexed. action_logs
// takes a row per command, so the index is built CONCURRENTLY (no transaction); dropping first
// removes an INVALID stub left by an interrupted build. Same shape as Migration20261008160939_audit_logs.
export class Migration20261008213000_audit_logs extends Migration {

  override name = 'Migration20261008213000';

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "action_logs_scan_idx";`);
    this.addSql(`create index concurrently "action_logs_scan_idx" on "action_logs" ("tenant_id", "organization_id", "created_at", "id") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "action_logs_scan_idx";`);
  }

}
