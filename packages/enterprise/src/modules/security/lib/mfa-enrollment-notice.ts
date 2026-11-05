const MFA_ENROLLMENT_REQUIRED_REASON = 'mfa_enrollment_required'
const MFA_ENROLLMENT_CONSUMED_PARAMS = ['reason', 'overdue', 'redirect'] as const

type SearchParamsLike = {
  get: (name: string) => string | null
}

export type MfaEnrollmentNoticeState = {
  visible: boolean
  overdue: boolean
}

export function resolveMfaEnrollmentNotice(
  searchParams: SearchParamsLike,
): MfaEnrollmentNoticeState {
  if (searchParams.get('reason') !== MFA_ENROLLMENT_REQUIRED_REASON) {
    return { visible: false, overdue: false }
  }

  return {
    visible: true,
    overdue: searchParams.get('overdue') === '1',
  }
}

export function removeMfaEnrollmentNoticeQueryFromHref(href: string): string | null {
  try {
    const url = new URL(href)
    let changed = false

    for (const paramName of MFA_ENROLLMENT_CONSUMED_PARAMS) {
      if (!url.searchParams.has(paramName)) continue
      url.searchParams.delete(paramName)
      changed = true
    }

    if (!changed) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

