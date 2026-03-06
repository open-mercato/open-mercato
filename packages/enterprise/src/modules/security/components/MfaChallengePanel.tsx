'use client'

import * as React from 'react'
import { ShieldCheck, AlertTriangle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

export type MfaChallengeMethod = {
  type: string
  label: string
  icon: string
}

type MfaChallengePanelProps = {
  challengeId: string
  availableMethods: MfaChallengeMethod[]
  onBack: () => void
}

export default function MfaChallengePanel({
  challengeId,
  availableMethods,
  onBack,
}: MfaChallengePanelProps) {
  const t = useT()

  return (
    <section
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
      data-testid="security-mfa-challenge-panel"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">
            {t('security.login.mfaChallenge.title', 'Multi-factor authentication required')}
          </h2>
          <p className="text-sm text-amber-900/90">
            {t(
              'security.login.mfaChallenge.description',
              'Complete MFA verification to finish signing in.',
            )}
          </p>
          {availableMethods.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {availableMethods.map((method) => (
                <li key={`${challengeId}:${method.type}`} className="rounded-full border border-amber-400 bg-white px-2 py-1 text-xs font-medium">
                  {method.label}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-amber-400/60 bg-white px-2 py-1.5 text-xs">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              <span>{t('security.login.mfaChallenge.noMethods', 'No MFA methods are currently available for this account.')}</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" onClick={onBack}>
              {t('security.login.mfaChallenge.actions.back', 'Back to sign in')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
