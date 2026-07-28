import { Migration } from '@mikro-orm/migrations';

export class Migration20260728134212_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "roles" add "min_active_holders" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "roles" drop column "min_active_holders";`);
  }

}
