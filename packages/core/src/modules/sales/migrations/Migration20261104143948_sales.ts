import { Migration } from '@mikro-orm/migrations';

export class Migration20261104143948_sales extends Migration {

  override name = 'Migration20261104143948';

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_settings" add "default_quote_validity_days" int not null default 14;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_settings" drop column "default_quote_validity_days";`);
  }

}
