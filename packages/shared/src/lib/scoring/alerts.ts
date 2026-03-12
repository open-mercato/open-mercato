/**
 * Configurable alert framework.
 * Modules define alert rules with conditions, severity functions, and messages.
 * The framework evaluates all rules against input params and returns matching alerts.
 */

export type AlertSeverity = 'info' | 'warning' | 'error'

export type Alert = {
  type: string
  severity: AlertSeverity
  message?: string
  tab?: string
  metadata?: Record<string, unknown>
}

export type AlertRule<T = Record<string, unknown>> = {
  type: string
  condition: (params: T) => boolean
  severity: (params: T) => AlertSeverity
  tab?: string
  metadata?: (params: T) => Record<string, unknown>
}

/**
 * Evaluate alert rules against parameters and return matching alerts.
 *
 * @param rules - Array of alert rules to evaluate
 * @param params - Input parameters for rule evaluation
 * @returns Array of triggered alerts
 */
export function evaluateAlerts<T>(
  rules: AlertRule<T>[],
  params: T,
): Alert[] {
  const alerts: Alert[] = []

  for (const rule of rules) {
    if (rule.condition(params)) {
      alerts.push({
        type: rule.type,
        severity: rule.severity(params),
        tab: rule.tab,
        metadata: rule.metadata?.(params),
      })
    }
  }

  return alerts
}
