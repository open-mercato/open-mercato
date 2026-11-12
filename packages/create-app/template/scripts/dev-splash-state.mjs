function hasUsableReadyTarget(state) {
  if (!state || typeof state !== 'object') return false
  return typeof state.loginUrl === 'string' && state.loginUrl.trim().length > 0
    || typeof state.readyUrl === 'string' && state.readyUrl.trim().length > 0
}

// The structured runtime payload is the authority for post-ready problems.
// `ready` is only a compatibility projection, so it must not erase an incident
// that the collector still considers active for the current generation.
export function hasActiveRuntimeIncident(state) {
  const runtime = state?.runtime
  if (!runtime || typeof runtime !== 'object') return false
  if (runtime.health === 'degraded' || runtime.health === 'unavailable') return true
  if (!Array.isArray(runtime.incidents)) return false
  return runtime.incidents.some((incident) => (
    incident && typeof incident === 'object' && incident.generation === runtime.generation
  ))
}

export function shouldPreferReadySplashState(state) {
  if (!state || typeof state !== 'object') return false
  if (state.ready !== true) return false
  if (hasActiveRuntimeIncident(state)) return false

  const phase = typeof state.phase === 'string' ? state.phase : ''
  const detail = typeof state.detail === 'string' ? state.detail : ''
  const progressLabel = typeof state.progressLabel === 'string' ? state.progressLabel : ''

  return hasUsableReadyTarget(state)
    || /\bapp is ready\b/i.test(phase)
    || /\bwarm(?:ed|up)\b/i.test(detail)
    || /\bavailable\b/i.test(detail)
    || /\bapp is ready\b/i.test(progressLabel)
}

export function normalizeSplashDisplayState(state) {
  if (!state || typeof state !== 'object') {
    return state
  }

  if (!shouldPreferReadySplashState(state)) {
    return { ...state }
  }

  const normalizedState = {
    ...state,
    failed: false,
    failureLines: [],
    failureCommand: null,
  }

  if (typeof normalizedState.phase !== 'string' || /\b(error|failed)\b/i.test(normalizedState.phase)) {
    normalizedState.phase = 'App is ready'
  }

  return normalizedState
}
