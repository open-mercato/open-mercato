import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082519_currencies extends Migration {

  override name = 'Migration20261014082519';

  override up(): void | Promise<void> {
    this.addSql(`alter table "exchange_rates" add "metadata" jsonb null;`);
    this.addSql(`alter table "exchange_rates" alter column "rate" type numeric using ("rate"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "exchange_rates" drop column "metadata";`);
    this.addSql(`alter table "exchange_rates" alter column "rate" type numeric(18,8) using ("rate"::numeric(18,8));`);
  }

}
