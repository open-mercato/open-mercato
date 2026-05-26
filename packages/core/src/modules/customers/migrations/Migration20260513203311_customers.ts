import { Migration } from '@mikro-orm/migrations';

export class Migration20260513203311_customers extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_settings" add "stuck_threshold_days" int not null default 14;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_settings" drop column "stuck_threshold_days";`);
  }

}
