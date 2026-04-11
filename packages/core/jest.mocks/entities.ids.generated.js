// Minimal stub for generated entity ids used in unit tests.
// Real builds generate this file at packages/core/generated/entities.ids.generated.ts
// via `yarn generate`. Tests only need stable string constants.

const E = {
  customers: {
    customer_person: 'customers.customer_person',
    customer_company: 'customers.customer_company',
    customer_deal: 'customers.customer_deal',
    customer_activity: 'customers.customer_activity',
    customer_comment: 'customers.customer_comment',
  },
  auth: {
    user: 'auth.user',
    role: 'auth.role',
  },
  attachments: {
    attachment: 'attachments.attachment',
  },
  sales: {
    sales_order: 'sales.sales_order',
    sales_quote: 'sales.sales_quote',
  },
  catalog: {
    catalog_product: 'catalog.catalog_product',
    catalog_product_variant: 'catalog.catalog_product_variant',
  },
}

const M = {
  customers: 'customers',
  auth: 'auth',
  attachments: 'attachments',
  sales: 'sales',
  catalog: 'catalog',
}

module.exports = { E, M }

