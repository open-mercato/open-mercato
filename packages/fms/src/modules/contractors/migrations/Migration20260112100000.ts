import { Migration } from '@mikro-orm/migrations';

export class Migration20260112100000_contractor_addresses_simplify extends Migration {

  override async up(): Promise<void> {
    // Drop label and country_code columns
    this.addSql(`alter table "contractor_addresses" drop column if exists "label";`);
    this.addSql(`alter table "contractor_addresses" drop column if exists "country_code";`);

    // Add country column
    this.addSql(`alter table "contractor_addresses" add column "country" text null;`);

    // Make city and address_line nullable
    this.addSql(`alter table "contractor_addresses" alter column "city" drop not null;`);
    this.addSql(`alter table "contractor_addresses" alter column "address_line" drop not null;`);
  }

  override async down(): Promise<void> {
    // Add back label and country_code columns
    this.addSql(`alter table "contractor_addresses" add column "label" text null;`);
    this.addSql(`alter table "contractor_addresses" add column "country_code" text not null default '';`);

    // Drop country column
    this.addSql(`alter table "contractor_addresses" drop column "country";`);

    // Make city and address_line required again
    this.addSql(`alter table "contractor_addresses" alter column "city" set not null;`);
    this.addSql(`alter table "contractor_addresses" alter column "address_line" set not null;`);
  }
}
