
export async function apiRequest(baseUrl, path, { method = 'GET', token, json, form, timeoutMs = 60000 } = {}) {
  const headers = { accept: 'application/json' }
  let body
  if (token) headers.authorization = `Bearer ${token}`
  if (json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(json)
  }
  if (form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(form).toString()
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text.slice(0, 500) }
  }
  return { status: response.status, ok: response.ok, data }
}

export async function login(baseUrl, { email, password, tenantId }) {
  const form = { email, password }
  if (tenantId) form.tenantId = tenantId
  const response = await apiRequest(baseUrl, '/api/auth/login', { method: 'POST', form })
  const token = response.data?.token
  if (!response.ok || typeof token !== 'string') {
    throw new Error(`[perf] login failed for ${email} (HTTP ${response.status})`)
  }
  return token
}

export async function waitForHealth(baseUrl, { timeoutMs = 20 * 60 * 1000, intervalMs = 5000, log = () => undefined } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(5000) })
      if (response.ok) return true
      lastStatus = `HTTP ${response.status}`
    } catch (error) {
      lastStatus = error.cause?.code ?? error.message
    }
    log(`waiting for ${baseUrl}/api/healthz (${lastStatus})`)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs))
  }
  throw new Error(`[perf] ${baseUrl}/api/healthz not healthy after ${Math.round(timeoutMs / 1000)} s (${lastStatus})`)
}

export function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
