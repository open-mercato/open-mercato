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
   * HARD: without these the module cannot function at all.
   *
   * `customers` owns the person this module sends to, `customer_accounts` the portal session the preference
   * centre runs on, `business_rules` the condition language every audience is written in.
   */
  requires: ['customers', 'customer_accounts', 'business_rules'],
  /**
   * SOFT: declared now so a CRM-only installation can enable the module; no reader exists in phase 1a.
   *
   * Phase 1a adds the package, the schema and the vocabulary — nothing reads `sales` or `catalog` yet, so this
   * declaration only records the intended optionality. The guarded readers (a capability probe plus the tests
   * that keep the reader list complete) land with the code that reads those modules, in a later phase of this
   * stack. Until then it does not claim that the later raw-SQL reads already degrade when `sales` or `catalog`
   * is absent.
   */
  optionalRequires: ['sales', 'catalog'],
}
