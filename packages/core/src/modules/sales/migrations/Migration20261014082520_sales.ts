import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082520_sales extends Migration {

  override name = 'Migration20261014082520';

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_shipping_methods" alter column "base_rate_gross" type numeric using ("base_rate_gross"::numeric);`);
    this.addSql(`alter table "sales_shipping_methods" alter column "base_rate_net" type numeric using ("base_rate_net"::numeric);`);

    this.addSql(`alter table "sales_quotes" alter column "discount_total_amount" type numeric using ("discount_total_amount"::numeric);`);
    this.addSql(`alter table "sales_quotes" alter column "grand_total_gross_amount" type numeric using ("grand_total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_quotes" alter column "grand_total_net_amount" type numeric using ("grand_total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_quotes" alter column "subtotal_gross_amount" type numeric using ("subtotal_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_quotes" alter column "subtotal_net_amount" type numeric using ("subtotal_net_amount"::numeric);`);
    this.addSql(`alter table "sales_quotes" alter column "tax_total_amount" type numeric using ("tax_total_amount"::numeric);`);

    this.addSql(`alter table "sales_quote_lines" alter column "discount_amount" type numeric using ("discount_amount"::numeric);`);
    this.addSql(`alter table "sales_quote_lines" alter column "tax_amount" type numeric using ("tax_amount"::numeric);`);
    this.addSql(`alter table "sales_quote_lines" alter column "total_gross_amount" type numeric using ("total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_quote_lines" alter column "total_net_amount" type numeric using ("total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_quote_lines" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "sales_quote_lines" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);

    this.addSql(`alter table "sales_quote_adjustments" alter column "amount_gross" type numeric using ("amount_gross"::numeric);`);
    this.addSql(`alter table "sales_quote_adjustments" alter column "amount_net" type numeric using ("amount_net"::numeric);`);

    this.addSql(`alter table "sales_orders" alter column "discount_total_amount" type numeric using ("discount_total_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "exchange_rate" type numeric using ("exchange_rate"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "grand_total_gross_amount" type numeric using ("grand_total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "grand_total_net_amount" type numeric using ("grand_total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "outstanding_amount" type numeric using ("outstanding_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "paid_total_amount" type numeric using ("paid_total_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "refunded_total_amount" type numeric using ("refunded_total_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "shipping_gross_amount" type numeric using ("shipping_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "shipping_net_amount" type numeric using ("shipping_net_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "subtotal_gross_amount" type numeric using ("subtotal_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "subtotal_net_amount" type numeric using ("subtotal_net_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "surcharge_total_amount" type numeric using ("surcharge_total_amount"::numeric);`);
    this.addSql(`alter table "sales_orders" alter column "tax_total_amount" type numeric using ("tax_total_amount"::numeric);`);

    this.addSql(`alter table "sales_shipments" alter column "declared_value_gross" type numeric using ("declared_value_gross"::numeric);`);
    this.addSql(`alter table "sales_shipments" alter column "declared_value_net" type numeric using ("declared_value_net"::numeric);`);

    this.addSql(`alter table "sales_payments" alter column "amount" type numeric using ("amount"::numeric);`);
    this.addSql(`alter table "sales_payments" alter column "captured_amount" type numeric using ("captured_amount"::numeric);`);
    this.addSql(`alter table "sales_payments" alter column "refunded_amount" type numeric using ("refunded_amount"::numeric);`);

    this.addSql(`alter table "sales_order_lines" alter column "discount_amount" type numeric using ("discount_amount"::numeric);`);
    this.addSql(`alter table "sales_order_lines" alter column "tax_amount" type numeric using ("tax_amount"::numeric);`);
    this.addSql(`alter table "sales_order_lines" alter column "total_gross_amount" type numeric using ("total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_order_lines" alter column "total_net_amount" type numeric using ("total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_order_lines" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "sales_order_lines" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);

    this.addSql(`alter table "sales_return_lines" alter column "total_gross_amount" type numeric using ("total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_return_lines" alter column "total_net_amount" type numeric using ("total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_return_lines" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "sales_return_lines" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);

    this.addSql(`alter table "sales_order_adjustments" alter column "amount_gross" type numeric using ("amount_gross"::numeric);`);
    this.addSql(`alter table "sales_order_adjustments" alter column "amount_net" type numeric using ("amount_net"::numeric);`);

    this.addSql(`alter table "sales_invoices" alter column "discount_total_amount" type numeric using ("discount_total_amount"::numeric);`);
    this.addSql(`alter table "sales_invoices" alter column "grand_total_gross_amount" type numeric using ("grand_total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_invoices" alter column "grand_total_net_amount" type numeric using ("grand_total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_invoices" alter column "outstanding_amount" type numeric using ("outstanding_amount"::numeric);`);
    this.addSql(`alter table "sales_invoices" alter column "paid_total_amount" type numeric using ("paid_total_amount"::numeric);`);
    this.addSql(`alter table "sales_invoices" alter column "subtotal_gross_amount" type numeric using ("subtotal_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_invoices" alter column "subtotal_net_amount" type numeric using ("subtotal_net_amount"::numeric);`);
    this.addSql(`alter table "sales_invoices" alter column "tax_total_amount" type numeric using ("tax_total_amount"::numeric);`);

    this.addSql(`alter table "sales_payment_allocations" alter column "amount" type numeric using ("amount"::numeric);`);

    this.addSql(`alter table "sales_invoice_lines" alter column "discount_amount" type numeric using ("discount_amount"::numeric);`);
    this.addSql(`alter table "sales_invoice_lines" alter column "tax_amount" type numeric using ("tax_amount"::numeric);`);
    this.addSql(`alter table "sales_invoice_lines" alter column "total_gross_amount" type numeric using ("total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_invoice_lines" alter column "total_net_amount" type numeric using ("total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_invoice_lines" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "sales_invoice_lines" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);

    this.addSql(`alter table "sales_credit_memos" alter column "grand_total_gross_amount" type numeric using ("grand_total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_credit_memos" alter column "grand_total_net_amount" type numeric using ("grand_total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_credit_memos" alter column "subtotal_gross_amount" type numeric using ("subtotal_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_credit_memos" alter column "subtotal_net_amount" type numeric using ("subtotal_net_amount"::numeric);`);
    this.addSql(`alter table "sales_credit_memos" alter column "tax_total_amount" type numeric using ("tax_total_amount"::numeric);`);

    this.addSql(`alter table "sales_credit_memo_lines" alter column "tax_amount" type numeric using ("tax_amount"::numeric);`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "total_gross_amount" type numeric using ("total_gross_amount"::numeric);`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "total_net_amount" type numeric using ("total_net_amount"::numeric);`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "unit_price_gross" type numeric using ("unit_price_gross"::numeric);`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "unit_price_net" type numeric using ("unit_price_net"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_credit_memo_lines" alter column "unit_price_net" type numeric(18,4) using ("unit_price_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "unit_price_gross" type numeric(18,4) using ("unit_price_gross"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "tax_amount" type numeric(18,4) using ("tax_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "total_net_amount" type numeric(18,4) using ("total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memo_lines" alter column "total_gross_amount" type numeric(18,4) using ("total_gross_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_credit_memos" alter column "subtotal_net_amount" type numeric(18,4) using ("subtotal_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memos" alter column "subtotal_gross_amount" type numeric(18,4) using ("subtotal_gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memos" alter column "tax_total_amount" type numeric(18,4) using ("tax_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memos" alter column "grand_total_net_amount" type numeric(18,4) using ("grand_total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_credit_memos" alter column "grand_total_gross_amount" type numeric(18,4) using ("grand_total_gross_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_invoice_lines" alter column "unit_price_net" type numeric(18,4) using ("unit_price_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoice_lines" alter column "unit_price_gross" type numeric(18,4) using ("unit_price_gross"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoice_lines" alter column "discount_amount" type numeric(18,4) using ("discount_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoice_lines" alter column "tax_amount" type numeric(18,4) using ("tax_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoice_lines" alter column "total_net_amount" type numeric(18,4) using ("total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoice_lines" alter column "total_gross_amount" type numeric(18,4) using ("total_gross_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_invoices" alter column "subtotal_net_amount" type numeric(18,4) using ("subtotal_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoices" alter column "subtotal_gross_amount" type numeric(18,4) using ("subtotal_gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoices" alter column "discount_total_amount" type numeric(18,4) using ("discount_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoices" alter column "tax_total_amount" type numeric(18,4) using ("tax_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoices" alter column "grand_total_net_amount" type numeric(18,4) using ("grand_total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoices" alter column "grand_total_gross_amount" type numeric(18,4) using ("grand_total_gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoices" alter column "paid_total_amount" type numeric(18,4) using ("paid_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_invoices" alter column "outstanding_amount" type numeric(18,4) using ("outstanding_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_order_adjustments" alter column "amount_net" type numeric(18,4) using ("amount_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_order_adjustments" alter column "amount_gross" type numeric(18,4) using ("amount_gross"::numeric(18,4));`);

    this.addSql(`alter table "sales_order_lines" alter column "unit_price_net" type numeric(18,4) using ("unit_price_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_order_lines" alter column "unit_price_gross" type numeric(18,4) using ("unit_price_gross"::numeric(18,4));`);
    this.addSql(`alter table "sales_order_lines" alter column "discount_amount" type numeric(18,4) using ("discount_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_order_lines" alter column "tax_amount" type numeric(18,4) using ("tax_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_order_lines" alter column "total_net_amount" type numeric(18,4) using ("total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_order_lines" alter column "total_gross_amount" type numeric(18,4) using ("total_gross_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_orders" alter column "exchange_rate" type numeric(18,8) using ("exchange_rate"::numeric(18,8));`);
    this.addSql(`alter table "sales_orders" alter column "subtotal_net_amount" type numeric(18,4) using ("subtotal_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "subtotal_gross_amount" type numeric(18,4) using ("subtotal_gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "discount_total_amount" type numeric(18,4) using ("discount_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "tax_total_amount" type numeric(18,4) using ("tax_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "shipping_net_amount" type numeric(18,4) using ("shipping_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "shipping_gross_amount" type numeric(18,4) using ("shipping_gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "surcharge_total_amount" type numeric(18,4) using ("surcharge_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "grand_total_net_amount" type numeric(18,4) using ("grand_total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "grand_total_gross_amount" type numeric(18,4) using ("grand_total_gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "paid_total_amount" type numeric(18,4) using ("paid_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "refunded_total_amount" type numeric(18,4) using ("refunded_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_orders" alter column "outstanding_amount" type numeric(18,4) using ("outstanding_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_payment_allocations" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_payments" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_payments" alter column "captured_amount" type numeric(18,4) using ("captured_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_payments" alter column "refunded_amount" type numeric(18,4) using ("refunded_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_quote_adjustments" alter column "amount_net" type numeric(18,4) using ("amount_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_quote_adjustments" alter column "amount_gross" type numeric(18,4) using ("amount_gross"::numeric(18,4));`);

    this.addSql(`alter table "sales_quote_lines" alter column "unit_price_net" type numeric(18,4) using ("unit_price_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_quote_lines" alter column "unit_price_gross" type numeric(18,4) using ("unit_price_gross"::numeric(18,4));`);
    this.addSql(`alter table "sales_quote_lines" alter column "discount_amount" type numeric(18,4) using ("discount_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quote_lines" alter column "tax_amount" type numeric(18,4) using ("tax_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quote_lines" alter column "total_net_amount" type numeric(18,4) using ("total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quote_lines" alter column "total_gross_amount" type numeric(18,4) using ("total_gross_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_quotes" alter column "subtotal_net_amount" type numeric(18,4) using ("subtotal_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quotes" alter column "subtotal_gross_amount" type numeric(18,4) using ("subtotal_gross_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quotes" alter column "discount_total_amount" type numeric(18,4) using ("discount_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quotes" alter column "tax_total_amount" type numeric(18,4) using ("tax_total_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quotes" alter column "grand_total_net_amount" type numeric(18,4) using ("grand_total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_quotes" alter column "grand_total_gross_amount" type numeric(18,4) using ("grand_total_gross_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_return_lines" alter column "unit_price_net" type numeric(18,4) using ("unit_price_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_return_lines" alter column "unit_price_gross" type numeric(18,4) using ("unit_price_gross"::numeric(18,4));`);
    this.addSql(`alter table "sales_return_lines" alter column "total_net_amount" type numeric(18,4) using ("total_net_amount"::numeric(18,4));`);
    this.addSql(`alter table "sales_return_lines" alter column "total_gross_amount" type numeric(18,4) using ("total_gross_amount"::numeric(18,4));`);

    this.addSql(`alter table "sales_shipments" alter column "declared_value_net" type numeric(18,4) using ("declared_value_net"::numeric(18,4));`);
    this.addSql(`alter table "sales_shipments" alter column "declared_value_gross" type numeric(18,4) using ("declared_value_gross"::numeric(18,4));`);

    this.addSql(`alter table "sales_shipping_methods" alter column "base_rate_net" type numeric(16,4) using ("base_rate_net"::numeric(16,4));`);
    this.addSql(`alter table "sales_shipping_methods" alter column "base_rate_gross" type numeric(16,4) using ("base_rate_gross"::numeric(16,4));`);
  }

}
