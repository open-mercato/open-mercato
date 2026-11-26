const state = { token: null, refreshToken: null, issuedAt: 0, user: null }

export function sessionState() {
  return state
}

export function setSession({ token, refreshToken, user }) {
  state.token = token
  if (refreshToken !== undefined) state.refreshToken = refreshToken
  if (user !== undefined) state.user = user
  state.issuedAt = Date.now()
}

export function clearSession() {
  state.token = null
  state.refreshToken = null
  state.issuedAt = 0
}

export function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {}
}
