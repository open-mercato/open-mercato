import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import http from 'k6/http'
import { env } from './config.js'
import { request } from './http.js'
import { scopeIds, setUsersCount } from './catalog.js'
import { clearSession, sessionState, setSession } from './session.js'
import { vuRng } from './random.js'
import { pickOne } from './pure/prng.js'
import { loadFeatures } from './features.js'

const users = new SharedArray('users', () => {
  const parsed = JSON.parse(open(env.usersPath))
  const list = Array.isArray(parsed) ? parsed : parsed.users || []
  return list.filter((user) => user && user.email && user.password)
})

setUsersCount(users.length)

export function userCount() {
  return users.length
}

export function userForVu({ fromEnd = false } = {}) {
  if (users.length === 0) throw new Error('[internal] users.json has no usable accounts')
  const offset = (exec.vu.idInTest - 1) % users.length
  return users[fromEnd ? users.length - 1 - offset : offset]
}

function loginForm(user) {
  const form = { email: user.email, password: user.password, remember: '1' }
  const tenantId = scopeIds().tenantId
  if (env.loginWithTenant && tenantId) form.tenantId = tenantId
  return form
}

export function login(user, { keep = true } = {}) {
  const result = request({
    method: 'POST',
    path: '/api/auth/login',
    form: loginForm(user),
    name: 'login:login',
    group: 'auth',
    expect: (body) => body.ok === true && typeof body.token === 'string',
    anonymous: true,
  })
  clearCookies()
  const body = result.json()
  if (!result.ok || !body || typeof body.token !== 'string') return false
  if (keep) setSession({ token: body.token, refreshToken: body.refreshToken || null, user })
  return true
}

function clearCookies() {
  try {
    http.cookieJar().clear(env.baseUrl)
  } catch (error) {
    return
  }
}

function refresh() {
  const state = sessionState()
  if (!state.refreshToken) return false
  const result = request({
    method: 'POST',
    path: '/api/auth/session/refresh',
    body: { refreshToken: state.refreshToken },
    name: 'login:refresh',
    group: 'auth',
    expect: (body) => body.ok === true && typeof body.accessToken === 'string',
    anonymous: true,
  })
  clearCookies()
  const body = result.json()
  if (!result.ok || !body || typeof body.accessToken !== 'string') return false
  setSession({ token: body.accessToken })
  return true
}

export function ensureSession(options = {}) {
  const state = sessionState()
  if (state.token) {
    const ageSec = (Date.now() - state.issuedAt) / 1000
    if (ageSec < env.tokenRefreshAfterSec) return state
    if (refresh()) return sessionState()
    clearSession()
  }
  const user = userForVu(options)
  if (!login(user)) throw new Error(`[internal] login failed for VU ${exec.vu.idInTest}`)
  loadFeatures()
  return sessionState()
}

export function currentUser() {
  return sessionState().user
}

export function measureLogin() {
  const user = pickOne(vuRng(), users)
  if (!user) return false
  return login(user, { keep: false })
}
