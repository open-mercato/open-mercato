import { Migration } from '@mikro-orm/migrations';

export class Migration20251123105433 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_products" add column "weight_value" numeric(16,4) null, add column "weight_unit" text null, add column "dimensions" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_products" drop column "weight_value", drop column "weight_unit", drop column "dimensions";`);
  }

}
