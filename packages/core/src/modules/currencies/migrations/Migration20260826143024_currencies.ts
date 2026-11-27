import { Migration } from '@mikro-orm/migrations';

export class Migration20260826143024_currencies extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "exchange_rates" add "external_reference" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "exchange_rates" drop column "external_reference";`);
  }

}
