import type { Attributes } from '../types'
import { getActiveProvider } from '../provider/registry'

/**
 * Metric helpers. Labels MUST be low-cardinality (never tenant/org/user IDs —
 * those belong on span attributes, per the telemetry spec's R4). The active
 * provider caches the underlying instrument by name; these are no-ops when
 * metrics are off.
 */
export function counter(name: string, value = 1, labels?: Attributes, unit?: string): void {
  getActiveProvider().recordMetric({ kind: 'counter', name, value, labels, unit })
}

export function histogram(name: string, value: number, labels?: Attributes, unit?: string): void {
  getActiveProvider().recordMetric({ kind: 'histogram', name, value, labels, unit })
}

export function gauge(name: string, value: number, labels?: Attributes, unit?: string): void {
  getActiveProvider().recordMetric({ kind: 'gauge', name, value, labels, unit })
}
