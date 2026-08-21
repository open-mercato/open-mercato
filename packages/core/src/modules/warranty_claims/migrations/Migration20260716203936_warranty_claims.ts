import { Migration } from '@mikro-orm/migrations';

export class Migration20260716203936_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "warranty_claim_settings" add column "return_window_days" int null;`);
    this.addSql(`create index "warranty_claims_return_tracking_idx" on "warranty_claims" ("tenant_id", "organization_id", "return_tracking_number") where "return_tracking_number" is not null and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "warranty_claims_return_tracking_idx";`);
    this.addSql(`alter table "warranty_claim_settings" drop column "return_window_days";`);
  }

}
