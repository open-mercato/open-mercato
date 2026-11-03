import { Migration } from '@mikro-orm/migrations';

export class Migration20260719120000_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index "warranty_claim_lines_serial_idx" on "warranty_claim_lines" ("tenant_id", "organization_id", "serial_number");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "warranty_claim_lines_serial_idx";`);
  }

}
