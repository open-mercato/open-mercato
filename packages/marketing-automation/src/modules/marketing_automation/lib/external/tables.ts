/**
 * Every table this module reads that another module owns.
 *
 * Marketing automation answers questions like "who bought this category in the last ninety days and has not
 * opened anything since" — questions whose facts live in `sales`, `catalog` and `customers`. So it reads their
 * tables, and the review of this module rightly called that out: there were foreign table names spelled in
 * sixteen files, which is coupling nobody can audit and nothing can hold still.
 *
 * Naming them here does NOT decouple anything, and this file does not pretend to. What it buys is that the
 * coupling is ENUMERABLE: this list is the complete answer to "what does marketing read that it does not
 * own", a rename upstream is one edit rather than a search, and `__tests__/external-reads-are-declared.test.ts`
 * fails when a foreign table name is spelled anywhere else.
 *
 * Deliberately names only, not reader functions and not join fragments either.
 *
 * Readers returning rows are the wrong shape: These reads are analytical aggregates that join
 * marketing's own tables to these in ONE statement — attribution joins send events to runs to orders, the
 * subject document joins order lines to orders to category assignments to categories. The join is the point;
 * pulling the foreign rows into JS to join them in memory would turn a single indexed query into a population
 * walk, which is the one thing this module's guidance forbids outright. A seam that made the module slower and
 * more fragile while LOOKING decoupled would be worse than the honesty of this list.
 *
 * Join fragments were tried and removed. Ten queries join order lines to orders identically, and hoisting
 * that shape would save nine copies of one condition — but it puts a constant where a reader expects to see
 * the query, and this very change showed the cost: the sibling line-filter guard reads the SQL as written and
 * reported ZERO queries the moment the table names moved behind constants. One layer of indirection was worth
 * it because it buys an enforced audit; a second buys tidiness and pays in guards that cannot see what they
 * guard. The review asked for auditable coupling, not for fewer joins.
 *
 * The real fix is a platform data contract plus optional module dependencies — `ModuleInfo.requires` is
 * enforced with `process.exit(1)` and has no optional form, so "sales and catalog are optional" cannot be
 * expressed today at all. That is a platform spec, tracked as an open question on the module's PR, and this
 * file is the seam it would replace.
 */

/** `sales` — what somebody bought, when, for how much, and through which channel. */
export const SALES_ORDERS = 'sales_orders'
export const SALES_ORDER_LINES = 'sales_order_lines'
export const SALES_CHANNELS = 'sales_channels'
export const SALES_INVOICES = 'sales_invoices'
export const SALES_PAYMENTS = 'sales_payments'

/**
 * `catalog` — the only purchase fact read live rather than from the order's snapshot.
 *
 * A category is a CURRENT classification while a sku is a historical fact, which is why the category
 * narrowing joins these and every other product fact comes from `catalog_snapshot` on the line.
 */
export const CATALOG_PRODUCTS = 'catalog_products'
export const CATALOG_PRODUCT_VARIANTS = 'catalog_product_variants'
export const CATALOG_PRODUCT_VARIANT_PRICES = 'catalog_product_variant_prices'
export const CATALOG_PRODUCT_CATEGORIES = 'catalog_product_categories'
export const CATALOG_PRODUCT_CATEGORY_ASSIGNMENTS = 'catalog_product_category_assignments'

/** `customers` — who the subject of a run actually is, and what has been said about them. */
export const CUSTOMER_ENTITIES = 'customer_entities'
export const CUSTOMER_PEOPLE = 'customer_people'
export const CUSTOMER_TAGS = 'customer_tags'
export const CUSTOMER_TAG_ASSIGNMENTS = 'customer_tag_assignments'
export const CUSTOMER_DEAL_PERSON_LINKS = 'customer_deal_person_links'
