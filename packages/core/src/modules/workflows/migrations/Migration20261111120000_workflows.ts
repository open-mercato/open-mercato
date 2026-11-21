import { Migration } from '@mikro-orm/migrations';

export class Migration20261111120000_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "user_tasks" add "completion" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "user_tasks" drop column "completion";`);
  }

}
