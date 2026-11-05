/**
 * Scheduler Module Entry Point
 * 
 * This file exposes module metadata and eager module resources.
 */

// Import events to register typed event declarations
import './events.js'

// Export module metadata
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'scheduler',
  title: 'Scheduler',
  description: 'Database-managed scheduled jobs with admin UI',
  version: '0.1.0',
}
