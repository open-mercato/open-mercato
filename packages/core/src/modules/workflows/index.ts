/**
 * Workflows Module
 *
 * Orchestrates long-running business processes with state management,
 * transitions, activities, user tasks, and event handling.
 */

import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'workflows',
  title: 'Workflow Engine',
  description: 'Orchestrate business processes with state machines, transitions, and activities',
  version: '1.0.0',
  author: 'Open Mercato',
  ejectable: true,
}
