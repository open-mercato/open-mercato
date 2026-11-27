import { Migration } from '@mikro-orm/migrations';

export class Migration20261020142226_resources extends Migration {

  override name = 'Migration20261020142226';

  override up(): void | Promise<void> {
    this.addSql(`alter table "resources_resource_activities" add "deleted_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "resources_resource_activities" drop column "deleted_at";`);
  }

}
