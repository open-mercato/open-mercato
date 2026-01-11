import { Migration } from '@mikro-orm/migrations';

export class Migration20260111192321 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "fms_offers" add column "version" int not null default 1, add column "payment_terms" text null, add column "special_terms" text null, add column "customer_notes" text null, add column "superseded_by_id" uuid null;`);

    this.addSql(`alter table "fms_offer_lines" add column "product_name" text null, add column "charge_code" text null, add column "container_size" text null;`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_name" type text using ("charge_name"::text);`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_name" drop not null;`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_category" type text using ("charge_category"::text);`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_category" drop not null;`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_unit" type text using ("charge_unit"::text);`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_unit" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_offers" drop column "version", drop column "payment_terms", drop column "special_terms", drop column "customer_notes", drop column "superseded_by_id";`);

    this.addSql(`alter table "fms_offer_lines" drop column "product_name", drop column "charge_code", drop column "container_size";`);

    this.addSql(`alter table "fms_offer_lines" alter column "charge_name" type text using ("charge_name"::text);`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_name" set not null;`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_category" type text using ("charge_category"::text);`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_category" set not null;`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_unit" type text using ("charge_unit"::text);`);
    this.addSql(`alter table "fms_offer_lines" alter column "charge_unit" set not null;`);
  }

}
