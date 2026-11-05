import { Migration } from '@mikro-orm/migrations';

export class Migration20251126121235 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_order_adjustments" add column "deleted_at" timestamptz null;`);

    this.addSql(`alter table "sales_document_addresses" drop constraint "sales_document_addresses_unique";`);
    this.addSql(`alter table "sales_document_addresses" drop column "address_id", drop column "address_snapshot";`);

    this.addSql(`alter table "sales_document_addresses" add column "customer_address_id" uuid null, add column "name" text null, add column "purpose" text null, add column "company_name" text null, add column "address_line1" text not null, add column "address_line2" text null, add column "city" text null, add column "region" text null, add column "postal_code" text null, add column "country" text null, add column "building_number" text null, add column "flat_number" text null, add column "latitude" real null, add column "longitude" real null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_order_adjustments" drop column "deleted_at";`);

    this.addSql(`alter table "sales_document_addresses" drop column "customer_address_id", drop column "name", drop column "purpose", drop column "company_name", drop column "address_line1", drop column "address_line2", drop column "city", drop column "region", drop column "postal_code", drop column "country", drop column "building_number", drop column "flat_number", drop column "latitude", drop column "longitude";`);

    this.addSql(`alter table "sales_document_addresses" add column "address_id" uuid not null, add column "address_snapshot" jsonb null;`);
    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_unique" unique ("document_id", "document_kind", "address_id");`);
  }

}
