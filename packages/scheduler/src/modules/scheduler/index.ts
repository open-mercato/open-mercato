/**
 * Scheduler module metadata
 */
export const metadata = {
  id: 'scheduler',
  name: 'Job Scheduler',
  description: 'Database-managed scheduled jobs with admin UI',
  version: '0.1.0',
}

// Import commands to register them
import './commands/jobs.js'
