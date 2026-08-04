import { computeEnvFingerprint } from '../lib/operators-store'
import { blockerSection, evaluatePullReadiness } from '../lib/pull-readiness'

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

describe('evaluatePullReadiness', () => {
  it('clears the pull when the environment is healthy and an operator is attached', () => {
    expect(evaluatePullReadiness({ environment, environmentHealthy: true, operator: attachedOperator })).toEqual({
      environmentReady: true,
      operatorAttached: true,
      envDrift: false,
      blocker: null,
    })
  })

  it('blocks on a missing environment', () => {
    const readiness = evaluatePullReadiness({ environment: null, environmentHealthy: false, operator: null })
    expect(readiness.blocker).toBe('environment_not_ready')
    expect(readiness.environmentReady).toBe(false)
  })

  it('blocks when the environment was never checked as healthy', () => {
    const readiness = evaluatePullReadiness({ environment, environmentHealthy: false, operator: attachedOperator })
    expect(readiness.blocker).toBe('environment_not_ready')
  })

  it('blocks when no operator is attached', () => {
    const readiness = evaluatePullReadiness({ environment, environmentHealthy: true, operator: null })
    expect(readiness.blocker).toBe('operator_missing')
    expect(readiness.operatorAttached).toBe(false)
  })

  it('blocks when the environment drifted after the operator was attached', () => {
    const readiness = evaluatePullReadiness({
      environment,
      environmentHealthy: true,
      operator: operatorWith('stale-fingerprint'),
    })
    expect(readiness.blocker).toBe('environment_drift')
    expect(readiness.envDrift).toBe(true)
  })

  it('reports an unready environment before a missing operator', () => {
    const readiness = evaluatePullReadiness({ environment: null, environmentHealthy: false, operator: null })
    expect(readiness.blocker).toBe('environment_not_ready')
  })

  it('maps blockers to the section the UI highlights', () => {
    expect(blockerSection('environment_not_ready')).toBe('environment')
    expect(blockerSection('operator_missing')).toBe('operator')
    expect(blockerSection('environment_drift')).toBe('operator')
  })
})
