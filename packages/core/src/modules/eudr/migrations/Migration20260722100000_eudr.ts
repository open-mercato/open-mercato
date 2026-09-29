import { Migration } from '@mikro-orm/migrations';

export class Migration20260722100000_eudr extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "eudr_product_mappings" add column "species_scientific_name" text null, add column "species_common_name" text null;`);

    this.addSql(`create index "eudr_dds_tenant_org_submitted_idx" on "eudr_due_diligence_statements" ("tenant_id", "organization_id", "submitted_at") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "eudr_dds_tenant_org_submitted_idx";`);

    this.addSql(`alter table "eudr_product_mappings" drop column "species_scientific_name", drop column "species_common_name";`);
  }

}
