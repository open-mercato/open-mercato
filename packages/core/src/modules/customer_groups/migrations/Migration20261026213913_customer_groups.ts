import { Migration } from '@mikro-orm/migrations';

export class Migration20261026213913_customer_groups extends Migration {

  override name = 'Migration20261026213913';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_purchase_approvals" add "requested_email_sent_at" timestamptz null, add "decided_email_sent_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_purchase_approvals" drop column "requested_email_sent_at", drop column "decided_email_sent_at";`);
  }

}
