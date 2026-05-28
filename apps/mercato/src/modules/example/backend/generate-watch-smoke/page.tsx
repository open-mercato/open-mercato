"use client"

import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function GenerateWatchSmokePage() {
  const t = useT()

  return (
    <Page>
      <PageHeader
        title={t('example.generateWatchSmoke.title', 'Generate Watch Smoke')}
        description={t(
          'example.generateWatchSmoke.description',
          'Small backend page used to verify structural module watch and sidebar regeneration.',
        )}
      />
      <PageBody>
        <section className="max-w-2xl rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-base font-medium">
                {t('example.generateWatchSmoke.statusTitle', 'Structural watch target')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  'example.generateWatchSmoke.statusDescription',
                  'If this page appears in the Example sidebar group, page metadata discovery and structural cache refresh are working.',
                )}
              </p>
            </div>
            <Badge variant="secondary">
              {t('example.generateWatchSmoke.badge', 'Smoke')}
            </Badge>
          </div>
        </section>
      </PageBody>
    </Page>
  )
}
