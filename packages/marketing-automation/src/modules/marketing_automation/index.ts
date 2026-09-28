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
}
