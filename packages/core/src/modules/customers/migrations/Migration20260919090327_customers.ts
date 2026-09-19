import { Migration } from '@mikro-orm/migrations';

// Customer tax exemption facts for spec
// .ai/specs/2026-09-19-pluggable-tax-providers.md.
//
// Additive and deployable without downtime: two nullable columns and one
// boolean whose default matches today's behaviour, so every existing customer
// is non exempt and no amount changes anywhere.
//
// tax_exemption_certificate is declared in the module's encryption map, so it
// is encrypted at rest: a certificate number identifies a specific person or
// business.
export class Migration20260919090327_customers extends Migration {

  override name = 'Migration20260919090327';

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_entities" add "is_tax_exempt" boolean not null default false, add "tax_exemption_code" text null, add "tax_exemption_certificate" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_entities" drop column "is_tax_exempt", drop column "tax_exemption_code", drop column "tax_exemption_certificate";`);
  }

}
