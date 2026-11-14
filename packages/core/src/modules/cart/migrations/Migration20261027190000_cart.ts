import { Migration } from '@mikro-orm/migrations';

export class Migration20261027190000_cart extends Migration {

  override name = 'Migration20261027190000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "carts" add column "awaiting_approval_since" timestamptz(6) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "carts" drop column "awaiting_approval_since";`);
  }

}
