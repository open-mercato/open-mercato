import { describeNumericWideningMigrations } from './__fixtures__/numericWideningMigrationHarness'
import { Migration20261027113555_cart } from '../modules/cart/migrations/Migration20261027113555_cart'
import { Migration20261014082519_catalog } from '../modules/catalog/migrations/Migration20261014082519_catalog'
import { Migration20261014082519_currencies } from '../modules/currencies/migrations/Migration20261014082519_currencies'
import { Migration20261014082519_customer_groups } from '../modules/customer_groups/migrations/Migration20261014082519_customer_groups'
import { Migration20261014082519_customers } from '../modules/customers/migrations/Migration20261014082519_customers'
import { Migration20261029222135_payment_gateways } from '../modules/payment_gateways/migrations/Migration20261029222135_payment_gateways'
import { Migration20261027113557_promotions } from '../modules/promotions/migrations/Migration20261027113557_promotions'
import { Migration20261014082520_sales } from '../modules/sales/migrations/Migration20261014082520_sales'
import { Migration20261029222135_staff } from '../modules/staff/migrations/Migration20261029222135_staff'
import { Migration20261014082520_warranty_claims } from '../modules/warranty_claims/migrations/Migration20261014082520_warranty_claims'

describeNumericWideningMigrations('Core money columns widened to unconstrained numeric', [
  { migration: Migration20261027113555_cart, legacy: { precision: 16, scale: 4 } },
  { migration: Migration20261014082519_catalog, legacy: { precision: 16, scale: 4 } },
  {
    migration: Migration20261014082519_currencies,
    legacy: { precision: 18, scale: 8 },
    addedColumns: [{
      table: 'exchange_rates',
      column: 'metadata',
      dataType: 'jsonb',
      sample: { provider: 'ecb', rateSource: '0.1000000000000000000001', fetchedAt: '2026-10-14T08:25:19.000Z' },
    }],
  },
  { migration: Migration20261014082519_customer_groups, legacy: { precision: 16, scale: 2 } },
  {
    migration: Migration20261014082519_customers,
    legacy: { precision: 16, scale: 2 },
    legacyOverrides: { 'customer_deals.value_amount': { precision: 14, scale: 2 } },
  },
  { migration: Migration20261029222135_payment_gateways, legacy: { precision: 18, scale: 4 } },
  { migration: Migration20261027113557_promotions, legacy: { precision: 16, scale: 2 } },
  {
    migration: Migration20261014082520_sales,
    legacy: { precision: 18, scale: 4 },
    legacyOverrides: {
      'sales_orders.exchange_rate': { precision: 18, scale: 8 },
      'sales_shipping_methods.base_rate_net': { precision: 16, scale: 4 },
      'sales_shipping_methods.base_rate_gross': { precision: 16, scale: 4 },
    },
  },
  {
    migration: Migration20261029222135_staff,
    legacy: { precision: 14, scale: 4 },
    legacyOverrides: {
      'staff_time_report_entries.frozen_amount': { precision: 14, scale: 2 },
      'staff_time_reports.total_amount': { precision: 14, scale: 2 },
    },
  },
  { migration: Migration20261014082520_warranty_claims, legacy: { precision: 18, scale: 4 } },
])
