import { Migration } from '@mikro-orm/migrations';

export class Migration20261125165127_currencies extends Migration {

  override name = 'Migration20261125165127';

  override up(): void | Promise<void> {
    this.addSql(`alter table "exchange_rates" add "undo_lineage" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "exchange_rates" drop column "undo_lineage";`);
  }

}
