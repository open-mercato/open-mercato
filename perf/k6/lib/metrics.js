import { Counter, Trend } from 'k6/metrics'

export const conflicts = new Counter('om_conflicts')
export const journeyDuration = new Trend('om_journey_duration', true)
export const journeyRuns = new Counter('om_journey_runs')
export const bulkJobDuration = new Trend('om_bulk_job_duration', true)
