import { Migration } from '@mikro-orm/migrations';

export class Migration20251230151605 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "exchange_rates" drop constraint "exchange_rates_pair_date_unique";`);
    this.addSql(`drop index "exchange_rates_pair_idx";`);
    this.addSql(`alter table "exchange_rates" drop column "expires_at";`);

    // Rename effective_date to date
    this.addSql(`alter table "exchange_rates" rename column "effective_date" to "date";`);
    
    // Change date type from date to timestamptz (convert existing dates to midnight UTC)
    this.addSql(`alter table "exchange_rates" alter column "date" type timestamptz using ("date"::timestamp at time zone 'UTC');`);
    
    // Set default source for existing NULL/empty records
    this.addSql(`update "exchange_rates" set "source" = 'manual' where "source" is null or "source" = '';`);
    
    // Make source NOT NULL and drop default
    this.addSql(`alter table "exchange_rates" alter column "source" drop default;`);
    this.addSql(`alter table "exchange_rates" alter column "source" set not null;`);
    this.addSql(`alter table "exchange_rates" alter column "source" type text using ("source"::text);`);
    
    // Create new unique constraint with source
    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_datetime_source_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "date", "source");`);
    this.addSql(`create index "exchange_rates_pair_idx" on "exchange_rates" ("from_currency_code", "to_currency_code", "date");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "exchange_rates" drop constraint "exchange_rates_pair_datetime_source_unique";`);
    this.addSql(`drop index "exchange_rates_pair_idx";`);

    this.addSql(`alter table "exchange_rates" add column "expires_at" timestamptz null;`);
    this.addSql(`alter table "exchange_rates" alter column "source" drop not null;`);
    this.addSql(`alter table "exchange_rates" alter column "source" type text using ("source"::text);`);
    this.addSql(`alter table "exchange_rates" alter column "source" set default 'manual';`);
    this.addSql(`alter table "exchange_rates" rename column "date" to "effective_date";`);
    this.addSql(`alter table "exchange_rates" alter column "effective_date" type date using ("effective_date"::date);`);
    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_date_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "effective_date");`);
    this.addSql(`create index "exchange_rates_pair_idx" on "exchange_rates" ("from_currency_code", "to_currency_code", "effective_date");`);
  }

}
