import { Migration } from '@mikro-orm/migrations';

export class Migration20261005110250_customer_groups extends Migration {

  override name = 'Migration20261005110250';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_group_terms" add "assortment_scope" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_group_terms" drop column "assortment_scope";`);
  }

}
