import { computeEnvFingerprint, type TillioOperatorRecord } from './operators-store'
import type { TillioResolvedEnvironment } from './operators'

// The two levels the environment alone can be blocked at. Pulling and attaching an operator ask
// different questions of the operator level, but the same question of this one, so they share it:
// the `enabled` term was once written out in both places and one copy drifted.
export type EnvironmentBlocker = 'integration_disabled' | 'environment_not_ready'

export type PullBlocker = EnvironmentBlocker | 'operator_missing' | 'environment_drift'

export type EnvironmentReadiness = {
  ready: boolean
  blocker: EnvironmentBlocker | null
}

export type EvaluateEnvironmentReadinessInput = {
  environment: TillioResolvedEnvironment | null
  integrationEnabled: boolean
  environmentHealthy: boolean
}

export function evaluateEnvironmentReadiness(input: EvaluateEnvironmentReadinessInput): EnvironmentReadiness {
  const ready = Boolean(input.environment) && input.integrationEnabled && input.environmentHealthy
  // A switched-off integration is reported ahead of health because re-running a health check would
  // not change anything while it is off - but only once there is something to switch on. A missing
  // integration row also reads as disabled, so reporting that first on a fresh install would tell
  // the user to enable an integration they have not configured yet, instead of to configure it.
  if (!input.integrationEnabled && input.environment) return { ready, blocker: 'integration_disabled' }
  if (!ready) return { ready, blocker: 'environment_not_ready' }
  return { ready, blocker: null }
}

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
  const environment = evaluateEnvironmentReadiness(input)
  const environmentReady = environment.ready
  const operatorAttached = Boolean(input.operator)
  const envDrift =
    Boolean(input.environment) &&
    Boolean(input.operator) &&
    input.operator!.envFingerprint !== computeEnvFingerprint(input.environment!)

  // Ordered so the reported blocker is the one the user can act on first: an unhealthy environment
  // makes operator state meaningless, and drift only matters once both levels exist. Each code
  // routes the UI to the settings section that fixes it.
  if (environment.blocker) {
    return { environmentReady, operatorAttached, envDrift, blocker: environment.blocker }
  }
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
