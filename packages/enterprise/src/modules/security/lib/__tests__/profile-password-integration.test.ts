import {
  SECURITY_PROFILE_PATH,
  isLegacySelfPasswordChangeAttempt,
  resolveLegacyProfilePasswordRedirect,
} from '../profile-password-integration'

describe('profile-password-integration', () => {
  test('maps legacy profile routes to the security profile page', () => {
    expect(resolveLegacyProfilePasswordRedirect('/backend/profile')).toBe(SECURITY_PROFILE_PATH)
    expect(resolveLegacyProfilePasswordRedirect('/backend/profile/change-password')).toBe(SECURITY_PROFILE_PATH)
    expect(resolveLegacyProfilePasswordRedirect('/backend/auth/profile/')).toBe(SECURITY_PROFILE_PATH)
    expect(resolveLegacyProfilePasswordRedirect('/backend/profile/security')).toBeNull()
  })

  test('detects legacy self-service password change attempts', () => {
    expect(isLegacySelfPasswordChangeAttempt({ id: 'user-1', password: 'Secret123!' }, 'user-1')).toBe(true)
    expect(isLegacySelfPasswordChangeAttempt({ id: 'user-2', password: 'Secret123!' }, 'user-1')).toBe(false)
    expect(isLegacySelfPasswordChangeAttempt({ id: 'user-1', password: '' }, 'user-1')).toBe(false)
    expect(isLegacySelfPasswordChangeAttempt({ id: 'user-1' }, 'user-1')).toBe(false)
  })
})
