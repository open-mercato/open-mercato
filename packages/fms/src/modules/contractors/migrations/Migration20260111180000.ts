import { Migration } from '@mikro-orm/migrations';

export class Migration20260111180000_contractors_simplify extends Migration {

  override async up(): Promise<void> {
    // Remove fields from contractors table
    this.addSql(`alter table "contractors" drop column if exists "code";`);
    this.addSql(`alter table "contractors" drop column if exists "legal_name";`);
    this.addSql(`alter table "contractors" drop column if exists "registration_number";`);

    // Drop the unique index on code
    this.addSql(`drop index if exists "contractors_code_unique";`);

    // Rename address_line1 to address_line and drop address_line2 from contractor_addresses
    this.addSql(`alter table "contractor_addresses" rename column "address_line1" to "address_line";`);
    this.addSql(`alter table "contractor_addresses" drop column if exists "address_line2";`);

    // Remove fields from contractor_contacts table
    this.addSql(`alter table "contractor_contacts" drop column if exists "job_title";`);
    this.addSql(`alter table "contractor_contacts" drop column if exists "department";`);
    this.addSql(`alter table "contractor_contacts" drop column if exists "mobile";`);
    this.addSql(`alter table "contractor_contacts" drop column if exists "notes";`);

    // Remove fields from contractor_credit_limits table
    this.addSql(`alter table "contractor_credit_limits" drop column if exists "current_exposure";`);
    this.addSql(`alter table "contractor_credit_limits" drop column if exists "last_calculated_at";`);
    this.addSql(`alter table "contractor_credit_limits" drop column if exists "requires_approval_above";`);
    this.addSql(`alter table "contractor_credit_limits" drop column if exists "approved_by_id";`);
    this.addSql(`alter table "contractor_credit_limits" drop column if exists "approved_at";`);
  }

  override async down(): Promise<void> {
    // Add back fields to contractors table
    this.addSql(`alter table "contractors" add column "code" text null;`);
    this.addSql(`alter table "contractors" add column "legal_name" text null;`);
    this.addSql(`alter table "contractors" add column "registration_number" text null;`);

    // Recreate the unique index on code
    this.addSql(`create unique index "contractors_code_unique" on "contractors" ("tenant_id", "organization_id", "code") where deleted_at is null and code is not null;`);

    // Rename address_line back to address_line1 and add address_line2 to contractor_addresses
    this.addSql(`alter table "contractor_addresses" rename column "address_line" to "address_line1";`);
    this.addSql(`alter table "contractor_addresses" add column "address_line2" text null;`);

    // Add back fields to contractor_contacts table
    this.addSql(`alter table "contractor_contacts" add column "job_title" text null;`);
    this.addSql(`alter table "contractor_contacts" add column "department" text null;`);
    this.addSql(`alter table "contractor_contacts" add column "mobile" text null;`);
    this.addSql(`alter table "contractor_contacts" add column "notes" text null;`);

    // Add back fields to contractor_credit_limits table
    this.addSql(`alter table "contractor_credit_limits" add column "current_exposure" numeric(18,2) not null default '0';`);
    this.addSql(`alter table "contractor_credit_limits" add column "last_calculated_at" timestamptz null;`);
    this.addSql(`alter table "contractor_credit_limits" add column "requires_approval_above" numeric(18,2) null;`);
    this.addSql(`alter table "contractor_credit_limits" add column "approved_by_id" uuid null;`);
    this.addSql(`alter table "contractor_credit_limits" add column "approved_at" timestamptz null;`);
  }
}
