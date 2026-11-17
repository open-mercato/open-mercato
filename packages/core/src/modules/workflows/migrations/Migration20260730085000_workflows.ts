import { Migration } from '@mikro-orm/migrations';

export class Migration20260730085000_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "workflow_definitions" add "granted_features" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "workflow_definitions" drop column "granted_features";`);
  }

}
