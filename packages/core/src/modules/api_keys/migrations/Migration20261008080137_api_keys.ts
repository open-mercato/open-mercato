import { Migration } from '@mikro-orm/migrations';

export class Migration20261008080137_api_keys extends Migration {

  override name = 'Migration20261008080137';

  override up(): void | Promise<void> {
    this.addSql(`set local lock_timeout = '5s';`);
    this.addSql(`alter table "api_keys" add "causation_json" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "api_keys" drop column "causation_json";`);
  }

}
