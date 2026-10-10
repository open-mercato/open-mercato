import { SIMULATION_LIMITS } from './constants'

const DAY_MS = 24 * 60 * 60 * 1000
const FUTURE_SLACK_MS = 5 * 60 * 1000

export type SimulationWindowInput = { days: number } | { from: string; to: string } | undefined

/**
 * The absolute history window of a request: `{ days }` (or the default 90 days) ending now, or an
 * explicit `{ from, to }` that ends no later than now (5 minutes of clock slack), starts before it
 * ends and spans at most 365 days. `null` when the window is not acceptable.
 */
export function resolveSimulationWindow(window: SimulationWindowInput, now: Date): { from: Date; to: Date } | null {
  if (!window) return { from: new Date(now.getTime() - SIMULATION_LIMITS.defaultWindowDays * DAY_MS), to: now }
  if ('days' in window) {
    if (!Number.isInteger(window.days) || window.days < 1 || window.days > SIMULATION_LIMITS.maxWindowDays) return null
    return { from: new Date(now.getTime() - window.days * DAY_MS), to: now }
  }
  const from = new Date(window.from)
  const to = new Date(window.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  if (to.getTime() > now.getTime() + FUTURE_SLACK_MS) return null
  if (from.getTime() >= to.getTime()) return null
  if (to.getTime() - from.getTime() > SIMULATION_LIMITS.maxWindowDays * DAY_MS) return null
  return { from, to }
}
