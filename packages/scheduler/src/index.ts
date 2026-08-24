/**
 * @open-mercato/scheduler
 * 
 * Database-managed scheduled jobs with admin UI
 */

export { ScheduledJob } from './modules/scheduler/data/entities.js'
export { SchedulerService } from './modules/scheduler/services/schedulerService.js'
export type { ScheduleRegistration } from './modules/scheduler/services/schedulerService.js'
export {
  getSchedulerSafeCommand,
  listSchedulerSafeCommands,
  registerSchedulerSafeCommands,
} from './modules/scheduler/lib/scheduler-safe-commands.js'
export type { SchedulerSafeCommandDefinition } from './modules/scheduler/lib/scheduler-safe-commands.js'

// Parsers and utilities
export { parseCronExpression, validateCron } from './modules/scheduler/lib/cronParser.js'
export { parseInterval, validateInterval, intervalToHuman } from './modules/scheduler/lib/intervalParser.js'
export { calculateNextRun, recalculateNextRun } from './modules/scheduler/lib/nextRunCalculator.js'
