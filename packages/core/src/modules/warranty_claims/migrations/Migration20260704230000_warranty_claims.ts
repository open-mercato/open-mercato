import { Migration } from '@mikro-orm/migrations';

export class Migration20260704230000_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" add column "external_ref" text null, add column "contact_email" text null;`);
    this.addSql(`create unique index "warranty_claims_external_ref_unique" on "warranty_claims" ("tenant_id", "organization_id", "external_ref") where "external_ref" is not null and "deleted_at" is null;`);
    this.addSql(`alter table "warranty_claim_settings" add column "default_warranty_months" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "warranty_claims_external_ref_unique";`);
    this.addSql(`alter table "warranty_claim_settings" drop column "default_warranty_months";`);
    this.addSql(`alter table "warranty_claims" drop column "external_ref", drop column "contact_email";`);
  }

}
