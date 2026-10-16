'use client'

import * as React from 'react'
import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SettingsResponse = { clearingAccountId: string | null }

/**
 * Shown while `PostingRulesSettings.clearingAccountId` is unset. Until an
 * admin configures it, source postings still succeed (a subscriber cannot
 * reject them) and the by-nature and by-function P&L views quietly diverge,
 * so this is the visible signal the spec asks for (Risks & Impact Review;
 * Backend Pages). A banner rather than a notification: the condition is a
 * standing state, not an event, and it disappears once the setting is saved.
 *
 * Pass `clearingAccountId` when the caller already loaded the settings (the
 * settings page); otherwise the banner fetches them itself and renders
 * nothing when the request fails.
 */
export function ClearingAccountBanner({ clearingAccountId }: { clearingAccountId?: string | null }) {
  const t = useT()
  const [fetched, setFetched] = React.useState<string | null | undefined>(undefined)

  React.useEffect(() => {
    if (clearingAccountId !== undefined) return
    let cancelled = false
    apiCall<SettingsResponse>('/api/posting_rules/settings')
      .then((response) => {
        if (!cancelled && response.ok && response.result) setFetched(response.result.clearingAccountId ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [clearingAccountId])

  const value = clearingAccountId !== undefined ? clearingAccountId : fetched
  if (value === undefined || value) return null

  return (
    <Alert variant="warning" className="mb-4">
      <AlertTitle>{t('posting_rules.banner.clearingAccountMissing.title', 'Cost reclassification is not running yet')}</AlertTitle>
      <AlertDescription>
        {t(
          'posting_rules.banner.clearingAccountMissing.body',
          'The clearing account is not configured, so zespół 4 postings are not being reclassified to zespół 5 and the two P&L views will disagree.',
        )}{' '}
        <Link href="/backend/posting_rules/settings" className="underline">
          {t('posting_rules.banner.clearingAccountMissing.action', 'Open posting rules settings')}
        </Link>
      </AlertDescription>
    </Alert>
  )
}
