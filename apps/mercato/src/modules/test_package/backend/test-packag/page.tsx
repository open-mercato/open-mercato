'use client'

import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function TestPackagePage() {
  const t = useT()

  return (
    <Page>
      <PageHeader
        title={t('test_package.page.title', 'Test Package')}
        description={t(
          'test_package.page.description',
          'Minimal backend page from a standalone workspace package.',
        )}
      />
      <PageBody>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-base font-semibold">
            {t('test_package.page.cardTitle', 'Package is wired correctly')}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              'test_package.page.cardDescription',
              'If this page renders, the package build, module discovery, and backend routing are working.',
            )}
          </p>
        </div>
      </PageBody>
    </Page>
  )
}
