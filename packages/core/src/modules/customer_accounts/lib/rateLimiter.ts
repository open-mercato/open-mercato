import { checkAuthRateLimit, resetAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'

export const customerLoginRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_LOGIN', {
  points: 5, duration: 60, blockDuration: 60, keyPrefix: 'customer-login',
})

export const customerLoginIpRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_LOGIN_IP', {
  points: 20, duration: 60, blockDuration: 60, keyPrefix: 'customer-login-ip',
})

export const customerSignupRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_SIGNUP', {
  points: 3, duration: 60, blockDuration: 120, keyPrefix: 'customer-signup',
})

export const customerSignupIpRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_SIGNUP_IP', {
  points: 10, duration: 60, blockDuration: 120, keyPrefix: 'customer-signup-ip',
})

export const customerPasswordResetRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_PASSWORD_RESET', {
  points: 3, duration: 60, blockDuration: 120, keyPrefix: 'customer-password-reset',
})

export const customerPasswordResetIpRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_PASSWORD_RESET_IP', {
  points: 10, duration: 60, blockDuration: 120, keyPrefix: 'customer-password-reset-ip',
})

export const customerMagicLinkRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_MAGIC_LINK', {
  points: 3, duration: 60, blockDuration: 120, keyPrefix: 'customer-magic-link',
})

export const customerMagicLinkIpRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_MAGIC_LINK_IP', {
  points: 10, duration: 60, blockDuration: 120, keyPrefix: 'customer-magic-link-ip',
})

// Staff- and portal-facing customer invitation endpoints
// (`/api/customer_accounts/admin/users-invite`, `/api/customer_accounts/portal/users-invite`).
// Both are authenticated, but a single authorized actor must not be able to mint
// unbounded invitation rows/tokens. The compound layer caps repeated invitations
// targeting the same recipient address from the same client, while the IP layer
// caps overall invitation throughput per client.
export const customerInviteRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_INVITE', {
  points: 5, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite',
})

export const customerInviteIpRateLimitConfig = readEndpointRateLimitConfig('CUSTOMER_INVITE_IP', {
  points: 20, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite-ip',
})

// Bulk custom-domain warm-up endpoint (`/api/customer_accounts/domain-resolve/all`).
// Single shared `DOMAIN_RESOLVE_SECRET` gates a payload that lists every active
// custom-domain mapping in the deployment, so we cap requests per IP to make
// brute-force or post-leak enumeration noisy. 30 req/min/IP comfortably covers
// the Node middleware warm-up cadence (one call per process boot) while
// staying well below useful enumeration throughput.
export const domainResolveAllIpRateLimitConfig = readEndpointRateLimitConfig('DOMAIN_RESOLVE_ALL_IP', {
  points: 30, duration: 60, blockDuration: 60, keyPrefix: 'domain-resolve-all',
})

export { checkAuthRateLimit, resetAuthRateLimit }
