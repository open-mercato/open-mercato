import { Migration } from '@mikro-orm/migrations';

export class Migration20260728134212_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "roles" add "min_active_holders" int not null default 0;`);
    this.addSql(`update "roles" set "min_active_holders" = 1 where "name" = 'admin' and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "roles" drop column "min_active_holders";`);
  }

}
