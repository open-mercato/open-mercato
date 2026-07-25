import { Migration } from '@mikro-orm/migrations';

export class Migration20260611104500 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index "access_logs_created_at_idx" on "access_logs" ("created_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "access_logs_created_at_idx";`);
  }

}
