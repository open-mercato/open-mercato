import { Migration } from '@mikro-orm/migrations';

export class Migration20261119194500_customer_groups extends Migration {

  override name = 'Migration20261119194500';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_group_terms" add "terms_currency_code" text null, add "approval_policy" text null, add "allow_quote_requests" boolean null, add "requires_po_number" boolean null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_group_terms" drop column "terms_currency_code", drop column "approval_policy", drop column "allow_quote_requests", drop column "requires_po_number";`);
  }

}
