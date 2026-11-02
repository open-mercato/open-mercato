import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

export class Migration20261030195138_customers extends Migration {

  override name = 'Migration20261030195138_customers';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_companies" add "tax_id" text null;`);
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'customers:customer_company_profile',
      fields: [{ field: 'tax_id' }],
    }));
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_companies" drop column "tax_id";`);
  }

}
