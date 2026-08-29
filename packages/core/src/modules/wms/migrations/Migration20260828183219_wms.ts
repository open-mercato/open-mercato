import { Migration } from '@mikro-orm/migrations';

export class Migration20260828183219_wms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "wms_sites" alter column "is_active" set default true;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wms_sites" alter column "is_active" set default false;`);
  }

}
