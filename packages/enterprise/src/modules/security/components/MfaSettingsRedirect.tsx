'use client'

import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

export default function MfaSettingsRedirect() {
  const t = useT()

  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'security.profile.mfa.description',
          'Manage your MFA methods and recovery codes.',
        )}
      </p>
      <Button type="button" asChild size="sm" className="mt-3">
        <Link href="/backend/profile/security/mfa">
          {t('security.profile.mfa.manage', 'Manage MFA settings')}
        </Link>
      </Button>
    </div>
  )
}
