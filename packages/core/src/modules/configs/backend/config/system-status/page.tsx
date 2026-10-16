import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { extensionPoints } from '@open-mercato/core/modules/configs/extension-points'
import SystemStatusPanel from '../../../components/SystemStatusPanel'

export default async function SystemStatusPage() {
  const { t } = await resolveTranslations()
  const linkText = t('configs.systemStatus.queuesStatusLink', 'View queue status')
  const linkPrompt = t('configs.systemStatus.queuesStatusPrompt', 'Looking for background job health?')

  return (
    <Page>
      <PageBody>
        <SystemStatusPanel />
        <p className="text-sm text-muted-foreground">
          {linkPrompt}{' '}
          <Link href="/backend/config/queues-status" className="font-medium text-primary hover:underline">
            {linkText}
          </Link>
        </p>
        <InjectionSpot
          spotId={extensionPoints.hosts.systemStatusDetails.spotId}
          context={{ path: '/backend/config/system-status' }}
        />
      </PageBody>
    </Page>
  )
}
