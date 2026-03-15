"use client"
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Card, CardContent, CardHeader, CardDescription } from '@open-mercato/ui/primitives/card'
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'

export default function PortalInfoPage() {
  const t = useT()

  return (
    <PortalShell>
      <div className="mx-auto w-full max-w-lg py-12">
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">{t('portal.title', 'Customer Portal')}</h1>
            <CardDescription>{t('portal.subtitle', 'Self-service portal for customers')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('portal.info.instructions', 'Navigate to your organization portal using the URL format: /{orgSlug}/portal')}
            </p>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  )
}
