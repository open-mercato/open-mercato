import { computeEnvFingerprint, type TillioOperatorRecord } from './operators-store'
import type { TillioResolvedEnvironment } from './operators'

export type PullBlocker =
  | 'integration_disabled'
  | 'environment_not_ready'
  | 'operator_missing'
  | 'environment_drift'

export type PullReadiness = {
  environmentReady: boolean
  operatorAttached: boolean
  envDrift: boolean
  blocker: PullBlocker | null
}

export type EvaluatePullReadinessInput = {
  environment: TillioResolvedEnvironment | null
  integrationEnabled: boolean
  environmentHealthy: boolean
  operator: TillioOperatorRecord | null
}

export function evaluatePullReadiness(input: EvaluatePullReadinessInput): PullReadiness {
  const environmentReady = Boolean(input.environment) && input.integrationEnabled && input.environmentHealthy
  const operatorAttached = Boolean(input.operator)
  const envDrift =
    Boolean(input.environment) &&
    Boolean(input.operator) &&
    input.operator!.envFingerprint !== computeEnvFingerprint(input.environment!)

  // Ordered so the reported blocker is the one the user can act on first: an unhealthy environment
  // makes operator state meaningless, and drift only matters once both levels exist. Each code
  // routes the UI to the settings section that fixes it. A switched-off integration is reported
  // ahead of health because re-running a health check would not change anything while it is off.
  if (!input.integrationEnabled) {
    return { environmentReady, operatorAttached, envDrift, blocker: 'integration_disabled' }
  }
  if (!environmentReady) return { environmentReady, operatorAttached, envDrift, blocker: 'environment_not_ready' }
  if (!operatorAttached) return { environmentReady, operatorAttached, envDrift, blocker: 'operator_missing' }
  if (envDrift) return { environmentReady, operatorAttached, envDrift, blocker: 'environment_drift' }
  return { environmentReady, operatorAttached, envDrift, blocker: null }
}

export const PULL_BLOCKER_MESSAGES: Record<PullBlocker, string> = {
  integration_disabled: 'The Tillio integration is disabled. Enable it before pulling calls.',
  environment_not_ready: 'Configure the Tillio environment and run the health check first.',
  operator_missing: 'Attach a Tillio operator before pulling calls.',
  environment_drift: 'The environment changed after this operator was attached. Detach and attach it again before pulling calls.',
}

export function blockerSection(blocker: PullBlocker): 'environment' | 'operator' {
  if (blocker === 'integration_disabled' || blocker === 'environment_not_ready') return 'environment'
  return 'operator'
}
