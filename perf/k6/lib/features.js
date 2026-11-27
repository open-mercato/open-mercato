import { request } from './http.js'

export const GATED_FEATURES = [
  'customers.interactions.manage',
  'attachments.view',
  'audit_logs.view_self',
  'customer_groups.memberships.view',
  'warranty_claims.claim.view',
  'customer_accounts.view',
  'eudr.submissions.view',
]

const state = { granted: null }

export function loadFeatures() {
  const result = request({
    method: 'POST',
    path: '/api/auth/feature-check',
    body: { features: GATED_FEATURES },
    name: 'login:features',
    group: 'auth',
    expect: (body) => Array.isArray(body.granted),
  })
  const body = result.ok ? result.json() : null
  state.granted = body && Array.isArray(body.granted) ? new Set(body.granted) : new Set(GATED_FEATURES)
}

export function hasFeature(feature) {
  if (!feature) return true
  if (!state.granted) return true
  return state.granted.has(feature)
}
