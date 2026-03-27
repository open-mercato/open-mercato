import { Migration } from '@mikro-orm/migrations';

export class Migration20260326000001 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_order_lines" alter column "omnibus_reference_net" type numeric(18,4) using "omnibus_reference_net"::numeric;`);
    this.addSql(`alter table "sales_order_lines" alter column "omnibus_reference_gross" type numeric(18,4) using "omnibus_reference_gross"::numeric;`);

    this.addSql(`alter table "sales_quote_lines" alter column "omnibus_reference_net" type numeric(18,4) using "omnibus_reference_net"::numeric;`);
    this.addSql(`alter table "sales_quote_lines" alter column "omnibus_reference_gross" type numeric(18,4) using "omnibus_reference_gross"::numeric;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_order_lines" alter column "omnibus_reference_net" type text using "omnibus_reference_net"::text;`);
    this.addSql(`alter table "sales_order_lines" alter column "omnibus_reference_gross" type text using "omnibus_reference_gross"::text;`);

    this.addSql(`alter table "sales_quote_lines" alter column "omnibus_reference_net" type text using "omnibus_reference_net"::text;`);
    this.addSql(`alter table "sales_quote_lines" alter column "omnibus_reference_gross" type text using "omnibus_reference_gross"::text;`);
  }

}
