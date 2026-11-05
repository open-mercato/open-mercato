import { Migration } from '@mikro-orm/migrations';

export class Migration20260113081652 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "exchange_rates" drop constraint "exchange_rates_pair_datetime_source_type_unique";`);

    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_datetime_source_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "date", "source");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "exchange_rates" drop constraint "exchange_rates_pair_datetime_source_unique";`);

    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_datetime_source_type_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "date", "source", "type");`);
  }

}
