import { Migration } from '@mikro-orm/migrations';

export class Migration20260108202900 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "fms_quotes" drop constraint "fms_quotes_number_unique";`);

    this.addSql(`alter table "fms_quotes" alter column "quote_number" type text using ("quote_number"::text);`);
    this.addSql(`alter table "fms_quotes" alter column "quote_number" drop not null;`);
    this.addSql(`alter table "fms_quotes" alter column "direction" type text using ("direction"::text);`);
    this.addSql(`alter table "fms_quotes" alter column "direction" drop not null;`);
    this.addSql(`alter table "fms_quotes" alter column "cargo_type" type text using ("cargo_type"::text);`);
    this.addSql(`alter table "fms_quotes" alter column "cargo_type" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_quotes" alter column "quote_number" type text using ("quote_number"::text);`);
    this.addSql(`alter table "fms_quotes" alter column "quote_number" set not null;`);
    this.addSql(`alter table "fms_quotes" alter column "direction" type text using ("direction"::text);`);
    this.addSql(`alter table "fms_quotes" alter column "direction" set not null;`);
    this.addSql(`alter table "fms_quotes" alter column "cargo_type" type text using ("cargo_type"::text);`);
    this.addSql(`alter table "fms_quotes" alter column "cargo_type" set not null;`);
    this.addSql(`alter table "fms_quotes" add constraint "fms_quotes_number_unique" unique ("organization_id", "tenant_id", "quote_number");`);
  }

}
