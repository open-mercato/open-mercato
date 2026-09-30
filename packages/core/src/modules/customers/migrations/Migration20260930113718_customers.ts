import { Migration } from '@mikro-orm/migrations';

export class Migration20260930113718_customers extends Migration {

  override name = 'Migration20260930113718';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_deals" add "closed_at" timestamptz null, add "pre_close_status" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_deals" drop column "closed_at", drop column "pre_close_status";`);
  }

}
