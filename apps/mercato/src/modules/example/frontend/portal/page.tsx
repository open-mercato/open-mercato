"use client"
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Card, CardContent, CardHeader, CardDescription } from '@open-mercato/ui/primitives/card'
import { PortalLayout } from './components/PortalLayout'

export default function PortalInfoPage() {
  const t = useT()

  return (
    <PortalLayout>
      <div className="mx-auto w-full max-w-lg py-12">
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">{t('example.portal.title')}</h1>
            <CardDescription>{t('example.portal.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('example.portal.info.instructions')}
            </p>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
