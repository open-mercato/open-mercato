import { computeEnvFingerprint } from '../lib/operators-store'
import { PULL_BLOCKER_COPY } from '../lib/error-codes'
import { blockerSection, evaluateEnvironmentReadiness, evaluatePullReadiness, type PullBlocker } from '../lib/pull-readiness'
import englishCatalog from '../i18n/en.json'

const environment = { apiUrl: 'https://x.example.com', apiKey: 'k', tenantSystemId: 'OM-abc' }

function operatorWith(envFingerprint: string) {
  return {
    id: 'ringostat-1',
    plugin: 'Ringostat' as const,
    config: { key: 'secret' },
    token: 'tok',
    tenantDomain: 'app.example.com/OM-abc-ringostat-1',
    envFingerprint,
  }
}

const attachedOperator = operatorWith(computeEnvFingerprint(environment))

// The pull and the operator-attach route share this decision. It is asserted directly because a
// second caller now depends on it, and because the `enabled` term used to be written out at each
// call site, where one copy lost it.
describe('evaluateEnvironmentReadiness', () => {
  it.each([
    ['nothing configured', null, false, false, 'environment_not_ready'],
    ['configured but switched off', environment, false, true, 'integration_disabled'],
    ['configured, on, never checked healthy', environment, true, false, 'environment_not_ready'],
    ['configured, on and healthy', environment, true, true, null],
  ] as const)('%s', (_name, env, integrationEnabled, environmentHealthy, expected) => {
    const readiness = evaluateEnvironmentReadiness({ environment: env, integrationEnabled, environmentHealthy })
    expect(readiness.blocker).toBe(expected)
    expect(readiness.ready).toBe(expected === null)
  })
})

describe('evaluatePullReadiness', () => {
  it('clears the pull when the environment is healthy and an operator is attached', () => {
    expect(
      evaluatePullReadiness({ environment, integrationEnabled: true, environmentHealthy: true, operator: attachedOperator }),
    ).toEqual({
      environmentReady: true,
      operatorAttached: true,
      envDrift: false,
      blocker: null,
    })
  })

  it('blocks on a missing environment', () => {
    const readiness = evaluatePullReadiness({ environment: null, integrationEnabled: true, environmentHealthy: false, operator: null })
    expect(readiness.blocker).toBe('environment_not_ready')
    expect(readiness.environmentReady).toBe(false)
  })

  it('blocks when the environment was never checked as healthy', () => {
    const readiness = evaluatePullReadiness({ environment, integrationEnabled: true, environmentHealthy: false, operator: attachedOperator })
    expect(readiness.blocker).toBe('environment_not_ready')
  })

  // A disabled integration passes every other check, so without its own blocker the UI would
  // tell the user to re-run a health check that cannot change the outcome.
  it('blocks a disabled integration even when everything else is ready', () => {
    const readiness = evaluatePullReadiness({
      environment,
      integrationEnabled: false,
      environmentHealthy: true,
      operator: attachedOperator,
    })
    expect(readiness.blocker).toBe('integration_disabled')
    expect(readiness.environmentReady).toBe(false)
  })

  // A fresh install has no integration row, and a missing row reads as disabled. Reporting that
  // as the blocker would tell the user to enable an integration they have not configured yet,
  // so the missing environment has to win while there is nothing to switch on.
  it('reports the missing environment, not the switch, before anything is configured', () => {
    const readiness = evaluatePullReadiness({
      environment: null,
      integrationEnabled: false,
      environmentHealthy: false,
      operator: null,
    })
    expect(readiness.blocker).toBe('environment_not_ready')
    expect(readiness.environmentReady).toBe(false)
  })

  it('blocks when no operator is attached', () => {
    const readiness = evaluatePullReadiness({ environment, integrationEnabled: true, environmentHealthy: true, operator: null })
    expect(readiness.blocker).toBe('operator_missing')
    expect(readiness.operatorAttached).toBe(false)
  })

  it('blocks when the environment drifted after the operator was attached', () => {
    const readiness = evaluatePullReadiness({
      environment,
      integrationEnabled: true,
      environmentHealthy: true,
      operator: operatorWith('stale-fingerprint'),
    })
    expect(readiness.blocker).toBe('environment_drift')
    expect(readiness.envDrift).toBe(true)
  })

  it('reports an unready environment before a missing operator', () => {
    const readiness = evaluatePullReadiness({ environment: null, integrationEnabled: true, environmentHealthy: false, operator: null })
    expect(readiness.blocker).toBe('environment_not_ready')
  })

  it('maps blockers to the section the UI highlights', () => {
    expect(blockerSection('integration_disabled')).toBe('environment')
    expect(blockerSection('environment_not_ready')).toBe('environment')
    expect(blockerSection('operator_missing')).toBe('operator')
    expect(blockerSection('environment_drift')).toBe('operator')
  })
})

// The pull dialog once worded a switched-off integration as an unconfigured environment, so the
// server told the user to enable the integration and the screen told them to enter credentials
// they had already entered. Section mapping above was right; the copy was not.
describe('PULL_BLOCKER_COPY', () => {
  const blockers: PullBlocker[] = [
    'integration_disabled',
    'environment_not_ready',
    'operator_missing',
    'environment_drift',
  ]

  it('gives every blocker its own wording', () => {
    const keys = blockers.map((blocker) => PULL_BLOCKER_COPY[blocker].key)
    expect(new Set(keys).size).toBe(blockers.length)
  })

  it('words a disabled integration as a disabled integration', () => {
    expect(PULL_BLOCKER_COPY.integration_disabled.key).toBe('tillio.errors.integrationDisabled')
  })

  it('ships an English string for every key it names', () => {
    const catalog = englishCatalog as Record<string, string>
    for (const blocker of blockers) {
      expect(catalog[PULL_BLOCKER_COPY[blocker].key]).toBeTruthy()
    }
  })
})
