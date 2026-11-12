import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import UserEntitiesTable from '@open-mercato/core/modules/entities/components/UserEntitiesTable'

export default async function UserEntitiesPage() {
  const { t } = await resolveTranslations()
  return (
    <Page>
      <PageBody>
        <ContextHelp bulb title={t('entities.userEntities.help.title')} className="mb-4">
          <p className="mb-2">{t('entities.userEntities.help.description')}</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>{t('entities.userEntities.help.fields')}</li>
            <li>{t('entities.userEntities.help.create')}</li>
            <li>{t('entities.userEntities.help.api')}</li>
          </ul>
        </ContextHelp>
        <UserEntitiesTable />
      </PageBody>
    </Page>
  )
}
