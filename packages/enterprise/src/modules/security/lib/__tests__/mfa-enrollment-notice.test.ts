import {
  removeMfaEnrollmentNoticeQueryFromHref,
  resolveMfaEnrollmentNotice,
} from '../mfa-enrollment-notice'

describe('resolveMfaEnrollmentNotice', () => {
  test('returns hidden state when reason is missing', () => {
    const state = resolveMfaEnrollmentNotice(new URLSearchParams('redirect=%2Fbackend'))
    expect(state).toEqual({ visible: false, overdue: false })
  })

  test('returns hidden state for unknown reason token', () => {
    const state = resolveMfaEnrollmentNotice(new URLSearchParams('reason=other'))
    expect(state).toEqual({ visible: false, overdue: false })
  })

  test('returns visible state for mfa enrollment reason', () => {
    const state = resolveMfaEnrollmentNotice(
      new URLSearchParams('reason=mfa_enrollment_required&redirect=%2Fbackend'),
    )
    expect(state).toEqual({ visible: true, overdue: false })
  })

  test('marks notice as overdue when overdue=1', () => {
    const state = resolveMfaEnrollmentNotice(
      new URLSearchParams('reason=mfa_enrollment_required&overdue=1'),
    )
    expect(state).toEqual({ visible: true, overdue: true })
  })
})

describe('removeMfaEnrollmentNoticeQueryFromHref', () => {
  test('removes consumed redirect params and preserves unrelated query and hash', () => {
    const nextUrl = removeMfaEnrollmentNoticeQueryFromHref(
      'https://example.test/backend/profile/security/mfa?foo=1&reason=mfa_enrollment_required&overdue=1&redirect=%2Fbackend#section',
    )

    expect(nextUrl).toBe('/backend/profile/security/mfa?foo=1#section')
  })

  test('returns null when no consumed params exist', () => {
    const nextUrl = removeMfaEnrollmentNoticeQueryFromHref(
      'https://example.test/backend/profile/security/mfa?foo=1',
    )
    expect(nextUrl).toBeNull()
  })

  test('returns null for invalid href values', () => {
    const nextUrl = removeMfaEnrollmentNoticeQueryFromHref('not-a-valid-url')
    expect(nextUrl).toBeNull()
  })
})

