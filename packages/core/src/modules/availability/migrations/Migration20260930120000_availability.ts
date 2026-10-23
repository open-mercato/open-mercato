import { Migration } from '@mikro-orm/migrations';

export class Migration20260930120000_availability extends Migration {

  override name = 'Migration20260930120000';

  override up(): void | Promise<void> {
    // `is_stock_managed` becomes nullable like the other cascading policy fields, so a
    // policy row (notably an org-wide / store default) can leave it unset (`null`) and
    // inherit it from the next less-specific row or the §5.2 module default.
    // Existing values are kept as stored.
    this.addSql(`alter table "availability_policies" alter column "is_stock_managed" drop default;`);
    this.addSql(`alter table "availability_policies" alter column "is_stock_managed" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`update "availability_policies" set "is_stock_managed" = false where "is_stock_managed" is null;`);
    this.addSql(`alter table "availability_policies" alter column "is_stock_managed" set default false;`);
    this.addSql(`alter table "availability_policies" alter column "is_stock_managed" set not null;`);
  }

}
