// HTTP helpers: staff login and timed requests with a bearer token.

export async function login(base, email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base, referer: `${base}/login` },
    body: new URLSearchParams({ email, password }),
    redirect: 'manual',
  })
  const json = await res.json().catch(() => null)
  // Never echo the response body: it can carry the token.
  if (!res.ok || !json?.token) throw new Error(`login as ${email} failed with HTTP ${res.status}`)
  return json.token
}

export async function timedGet(base, path, { token, organizationId, acceptLanguage } = {}) {
  const headers = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (organizationId) headers.cookie = `om_selected_org=${organizationId}`
  // Browsers always send Accept-Language; with it the API also resolves entity translations.
  if (acceptLanguage) headers['accept-language'] = acceptLanguage
  const started = process.hrtime.bigint()
  const res = await fetch(`${base}${path}`, { headers })
  const text = await res.text()
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  return { status: res.status, ms, bytes: Buffer.byteLength(text), text }
}

export function requireCredentials(values, env = process.env) {
  const email = values.email ?? env.BENCH_EMAIL
  const password = values.password ?? env.BENCH_PASSWORD
  if (!email || !password) {
    throw new Error('Set BENCH_EMAIL and BENCH_PASSWORD (a staff user of the measured tenant, e.g. the `mercato init` admin).')
  }
  return { email, password }
}
