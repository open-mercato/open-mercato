/**
 * Scheduler Module Entry Point
 * 
 * This file ensures commands and other module resources are imported
 * and registered when the module is loaded.
 */

// Import commands to trigger registration
import './commands/jobs.js'

// Import events to register typed event declarations
import './events.js'

// Export module metadata
export const metadata = {
  id: 'scheduler',
  name: 'Scheduler',
  description: 'Database-managed scheduled jobs with admin UI',
  version: '0.1.0',
}
