export {
  buildCacheKey,
  createSingleFlight,
  type CacheEntry,
  type ResultCache,
} from './cache'
export { DEADLINE_REACHED, deadlineRace, linkSignals, sleep, type Cancellable } from './deadline'
export { createSearchEngine } from './engine'
export { outcomeReason, outcomeToStatus, runAdapter, type AdapterRunResult } from './runAdapter'
export type {
  AdapterDiagnostic,
  AdapterDiagnosticStatus,
  AdapterHealthReport,
  AdapterResultSet,
  EngineAdapterEntry,
  HealthOptions,
  RunOptions,
  SearchDiagnostics,
  SearchEngine,
  SearchEngineOptions,
  SearchEngineResult,
} from './types'
