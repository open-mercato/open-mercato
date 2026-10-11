import { createProbePolicy } from './dev-runtime-state.mjs'

export const RUNTIME_HEALTH_PATH = '/api/healthz'

async function defaultProbeRequest(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    return { healthy: response.ok, status: response.status }
  } catch (error) {
    return { healthy: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

// Lightweight post-READY liveness check. It never re-runs the login warmup, it
// never logs a success, and it never exposes dependency details — the app's
// /api/healthz contract stays a plain 200/503.
export function createRuntimeProbe(options = {}) {
  const config = options.config ?? {}
  const intervalMs = Number.isInteger(config.intervalMs) ? config.intervalMs : 5000
  const timeoutMs = Number.isInteger(config.timeoutMs) ? config.timeoutMs : 1500
  const resolveBaseUrl = typeof options.resolveBaseUrl === 'function' ? options.resolveBaseUrl : () => null
  const request = typeof options.request === 'function' ? options.request : defaultProbeRequest
  const onDegraded = typeof options.onDegraded === 'function' ? options.onDegraded : () => {}
  const onRecovered = typeof options.onRecovered === 'function' ? options.onRecovered : () => {}
  const shouldRun = typeof options.shouldRun === 'function' ? options.shouldRun : () => true

  const policy = createProbePolicy(config)
  let timer = null
  let inFlight = false

  async function tick() {
    if (inFlight) return
    if (!shouldRun()) {
      policy.reset()
      return
    }
    const baseUrl = resolveBaseUrl()
    if (!baseUrl) return

    inFlight = true
    try {
      const result = await request(`${baseUrl.replace(/\/$/, '')}${RUNTIME_HEALTH_PATH}`, timeoutMs)
      const transition = policy.record(result.healthy === true)
      if (transition === 'degraded') onDegraded(result)
      if (transition === 'recovered') onRecovered(result)
    } finally {
      inFlight = false
    }
  }

  return {
    tick,
    getCounters: policy.getCounters,
    reset: policy.reset,
    start() {
      if (timer) return
      timer = setInterval(() => { void tick() }, intervalMs)
      timer.unref?.()
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
      policy.reset()
    },
  }
}
