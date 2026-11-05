'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'

export default function SettingsPage() {
  const t = useT()

  return (
    <Page>
      <PageHeader
        title={t('settings.page.title', 'Settings')}
        description={t('settings.page.description', 'System configuration and administration')}
      />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          {t('settings.page.selectItem', 'Select an item from the menu to configure system settings.')}
        </p>
      </PageBody>
    </Page>
  )
}
