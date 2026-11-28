import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  registerCapacityProvider,
  type CapacityDateRange,
  type CapacityProvider,
  type CapacityResult,
} from '@open-mercato/core/modules/staff/lib/time-tracking/capacity'

/**
 * Test-only EP-40 capacity provider (TC-STAFF-049).
 *
 * It registers through the real `registerCapacityProvider` registry from this
 * module's `di.ts`, the same place a third-party module contributes a provider, so
 * the staff capacity route, My Work and the Timesheet resolve it exactly as they
 * would a real contribution. A capacity provider is a single winner with no way to
 * decline a scope, so the probe is registered only while the integration spec has
 * requested it: `POST /api/example/qa-capacity-probe` raises a process-wide flag,
 * `DELETE` lowers it, and every request container re-syncs the registration with
 * that flag. The route answers 404 and the sync does nothing unless the
 * integration runner set `OM_INTEGRATION_TEST`.
 *
 * Its schedule is deliberately unlike the built-in flat target: Mondays carry a
 * zero target and every other working day carries a reduced one.
 */

export const QA_CAPACITY_PROBE_PROVIDER_ID = 'example.qa_capacity_probe'
export const QA_CAPACITY_PROBE_LABEL = 'QA capacity probe'
export const QA_CAPACITY_PROBE_DAY_MINUTES = 120

const PROBE_REQUESTED_KEY = '__exampleQaCapacityProbeRequested__'
const MONDAY = 1

function isMonday(isoDay: string): boolean {
  const [year, month, day] = isoDay.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === MONDAY
}

function resolveProbeCapacity(dateRange: CapacityDateRange): CapacityResult {
  const targetMinutesByDate: Record<string, number> = {}
  for (const date of dateRange.workingDays) {
    targetMinutesByDate[date] = isMonday(date) ? 0 : QA_CAPACITY_PROBE_DAY_MINUTES
  }
  const totalTargetMinutes = Object.values(targetMinutesByDate).reduce((sum, minutes) => sum + minutes, 0)
  return { targetMinutesByDate, totalTargetMinutes, label: QA_CAPACITY_PROBE_LABEL }
}

const qaCapacityProbe: CapacityProvider = {
  id: QA_CAPACITY_PROBE_PROVIDER_ID,
  resolve: (_staffMemberId, dateRange) => resolveProbeCapacity(dateRange),
  resolveAsync: async (_staffMemberId, dateRange) => resolveProbeCapacity(dateRange),
}

type ProbeFlag = Record<string, boolean | undefined>

let disposeRegistration: (() => void) | null = null

function probeFlags(): ProbeFlag {
  return globalThis as unknown as ProbeFlag
}

export function isQaCapacityProbeAvailable(): boolean {
  return parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)
}

export function setQaCapacityProbeRequested(requested: boolean): void {
  probeFlags()[PROBE_REQUESTED_KEY] = requested
}

export function syncQaCapacityProbeRegistration(): void {
  const requested = isQaCapacityProbeAvailable() && probeFlags()[PROBE_REQUESTED_KEY] === true
  if (requested && !disposeRegistration) {
    disposeRegistration = registerCapacityProvider(qaCapacityProbe)
  } else if (!requested && disposeRegistration) {
    disposeRegistration()
    disposeRegistration = null
  }
}
