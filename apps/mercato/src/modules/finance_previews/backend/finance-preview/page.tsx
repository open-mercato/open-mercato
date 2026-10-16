import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  detectLocale,
  loadDictionary,
} from '@open-mercato/shared/lib/i18n/server'
import { resolveForcedLocale } from '@open-mercato/shared/lib/i18n/locale'
import { FinancePreview } from '../../components/FinancePreview'
import { FinancePreviewLocaleRedirect } from '../../components/FinancePreviewLocaleRedirect'

export default async function FinancePreviewPage() {
  const locale = await detectLocale()
  const switchLocale = locale !== 'pl' && !resolveForcedLocale(process.env)
  const dict = await loadDictionary('pl')
  return (
    <I18nProvider locale="pl" dict={dict}>
      <Page>
        <PageBody>
          {switchLocale ? <FinancePreviewLocaleRedirect /> : <FinancePreview />}
        </PageBody>
      </Page>
    </I18nProvider>
  )
}
