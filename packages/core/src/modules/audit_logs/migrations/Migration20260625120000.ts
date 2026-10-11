import { Migration } from '@mikro-orm/migrations';

export class Migration20260625120000 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "action_logs" add column "on_behalf_of_user_id" uuid null;`);
    this.addSql(`create index "action_logs_obo_idx" on "action_logs" ("on_behalf_of_user_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "action_logs_obo_idx";`);
    this.addSql(`alter table "action_logs" drop column "on_behalf_of_user_id";`);
  }

}
