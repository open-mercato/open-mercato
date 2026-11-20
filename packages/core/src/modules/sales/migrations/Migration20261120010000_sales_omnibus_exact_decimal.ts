import { Migration } from '@mikro-orm/migrations'

export class Migration20261120010000_sales_omnibus_exact_decimal extends Migration {
  override up(): void {
    for (const table of ['sales_order_lines', 'sales_quote_lines']) {
      this.addSql(`alter table "${table}" alter column "omnibus_reference_net" type numeric, alter column "omnibus_reference_gross" type numeric;`)
    }
  }

  override down(): void {}
}
