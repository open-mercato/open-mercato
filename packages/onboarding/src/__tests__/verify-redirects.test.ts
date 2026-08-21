/** @jest-environment node */
import {
  redirectToLogin,
  redirectToPreparing,
  redirectWithStatus,
} from '../modules/onboarding/lib/verify-redirects'

const AUTH_COOKIES = ['auth_token', 'session_token', 'om_login_tenant'] as const

function getCookie(response: ReturnType<typeof redirectWithStatus>, name: string) {
  return response.cookies.get(name)
}

describe('onboarding verify redirect helpers', () => {
  describe('redirectWithStatus (validation / error paths)', () => {
    it('does NOT clear auth cookies on any status path (logout CSRF guard)', () => {
      for (const status of ['invalid', 'error', 'already_exists']) {
        const response = redirectWithStatus('https://app.example.com', status)
        for (const cookieName of AUTH_COOKIES) {
          expect(getCookie(response, cookieName)).toBeUndefined()
        }
      }
    })

    it('redirects to the onboarding status URL', () => {
      const response = redirectWithStatus('https://app.example.com', 'invalid')
      expect(response.headers.get('location')).toBe(
        'https://app.example.com/onboarding?status=invalid',
      )
    })

    it('does not mutate cookies even for an attacker-supplied error path', () => {
      const response = redirectWithStatus('https://app.example.com', 'error')
      expect(response.cookies.getAll()).toHaveLength(0)
    })
  })

  describe('redirectToPreparing (success transition)', () => {
    it('clears auth_token and session_token', () => {
      const response = redirectToPreparing('https://app.example.com', 'tenant-123')
      expect(getCookie(response, 'auth_token')?.value).toBe('')
      expect(getCookie(response, 'auth_token')?.maxAge).toBe(0)
      expect(getCookie(response, 'session_token')?.value).toBe('')
      expect(getCookie(response, 'session_token')?.maxAge).toBe(0)
    })

    it('sets om_login_tenant to the provisioned tenant id', () => {
      const response = redirectToPreparing('https://app.example.com', 'tenant-123')
      const tenantCookie = getCookie(response, 'om_login_tenant')
      expect(tenantCookie?.value).toBe('tenant-123')
      expect(tenantCookie?.maxAge).toBeGreaterThan(0)
    })

    it('clears om_login_tenant when no tenant id is provided', () => {
      const response = redirectToPreparing('https://app.example.com', null)
      expect(getCookie(response, 'om_login_tenant')?.value).toBe('')
      expect(getCookie(response, 'om_login_tenant')?.maxAge).toBe(0)
    })
  })

  describe('redirectToLogin (success transition)', () => {
    it('clears auth_token and session_token', () => {
      const response = redirectToLogin('https://app.example.com', 'tenant-123')
      expect(getCookie(response, 'auth_token')?.value).toBe('')
      expect(getCookie(response, 'auth_token')?.maxAge).toBe(0)
      expect(getCookie(response, 'session_token')?.value).toBe('')
      expect(getCookie(response, 'session_token')?.maxAge).toBe(0)
    })

    it('sets om_login_tenant to the provisioned tenant id', () => {
      const response = redirectToLogin('https://app.example.com', 'tenant-123')
      expect(getCookie(response, 'om_login_tenant')?.value).toBe('tenant-123')
    })
  })
})
