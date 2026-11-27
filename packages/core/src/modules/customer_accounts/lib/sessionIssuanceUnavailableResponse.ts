import { NextResponse } from 'next/server'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function sessionIssuanceUnavailableResponse(
  error: unknown,
  retry: 'same-request' | 'fresh-sign-in',
): Promise<NextResponse> {
  if (!(error instanceof AdvisoryLockUnavailableError)
    || (error.reason !== 'deadline' && error.reason !== 'transient_db')) {
    throw error
  }

  const { translate } = await resolveTranslations()
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (retry === 'same-request') headers.set('Retry-After', '1')

  return NextResponse.json({
    ok: false,
    error: translate(
      'customer_accounts.errors.busy',
      'Sign-in is temporarily unavailable. Go to the sign-in page and start again in a moment.',
    ),
  }, { status: 503, headers })
}
