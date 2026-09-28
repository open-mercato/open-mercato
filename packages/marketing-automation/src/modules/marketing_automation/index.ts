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
  // Hard dependencies, not soft ones: the subject document imports `customers` entities, the
  // trigger catalog and the sweep import `sales` entities, the audience layer imports the
  // `business_rules` evaluator and schema, and `add_tag` dispatches a `customers` command.
  // Without this, disabling one of them breaks this module at load with no diagnostic.
  requires: ['customers', 'sales', 'business_rules'],
}
