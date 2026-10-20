import { Migration } from '@mikro-orm/migrations';

export class Migration20261008080137_audit_logs extends Migration {

  override name = 'Migration20261008080137';

  override up(): void | Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);
    this.addSql(`alter table "action_logs" add "cause_kind" text null, add "cause_id" text null, add "correlation_id" uuid null, add "caused_by_log_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "action_logs" drop column "cause_kind", drop column "cause_id", drop column "correlation_id", drop column "caused_by_log_id";`);
  }

}
