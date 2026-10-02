/**
 * Marketing Automation module entry point.
 *
 * Exposes module metadata and eagerly registers typed event declarations.
 */
import './events.js'

import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'marketing_automation',
  title: 'Marketing Automation',
  description: 'Visual marketing campaigns: triggers, audience conditions and delayed action chains',
  version: '0.1.0',
  /**
   * Declared as hard dependencies because that is what they currently are.
   *
   * The subject document imports `customers` entities, the trigger catalog and the sweep import `sales`
   * entities, the audience layer imports the `business_rules` evaluator and schema, and `add_tag` dispatches a
   * `customers` command. `catalog` belongs here too and was missing: purchased-category narrowing and the
   * price-watch scan read `catalog_product_categories`, `catalog_product_category_assignments` and
   * `catalog_product_variant_prices`, so the dependency existed without being declared — invisible from the
   * modules it depends on, and a load-time break with no diagnostic when one of them is off.
   *
   * `sales` and `catalog` SHOULD be optional: a CRM-only installation has every reason to want campaigns, and
   * order- and category-based audiences should simply not be offered there. Making that true means deciding how
   * this module reads another module's data at all — today it is raw SQL against their tables, which is the
   * finding this comment does not pretend to have fixed. The read-model decision belongs in the spec, and the
   * degrade-when-absent work follows it rather than preceding it.
   *
   * `customer_accounts` is declared for the same reason `catalog` was: the portal preference centre reads its
   * session helpers (`api/portal/preferences/route.ts`), so the dependency existed undeclared. It carries none
   * of the optionality question above — both module registries enable it unconditionally.
   */
  requires: ['customers', 'customer_accounts', 'sales', 'catalog', 'business_rules'],
}
