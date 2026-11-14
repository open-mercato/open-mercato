import { Migration } from '@mikro-orm/migrations';

export class Migration20261028052954_audit_logs extends Migration {

  override name = 'Migration20261028052954';

  override up(): void | Promise<void> {
    this.addSql(`alter table "action_logs" add column if not exists "correlation_keys" text[] null;`);
    this.addSql(`create index if not exists "action_logs_correlation_keys_idx" on "action_logs" using gin ("correlation_keys");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "action_logs_correlation_keys_idx";`);
    this.addSql(`alter table "action_logs" drop column if exists "correlation_keys";`);
  }

}
