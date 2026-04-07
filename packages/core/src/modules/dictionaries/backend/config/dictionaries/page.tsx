import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DictionariesManager } from '../../../components/DictionariesManager'

export default async function DictionariesConfigurationPage({
  searchParams,
}: {
  searchParams?: { returnTo?: string | string[] }
}) {
  const { translate } = await resolveTranslations()
  const returnTo = typeof searchParams?.returnTo === 'string' && searchParams.returnTo.trim().length
    ? searchParams.returnTo.trim()
    : null

  return (
    <Page>
      <PageBody className="space-y-8">
        {returnTo ? (
          <Button asChild variant="outline" size="sm">
            <Link href={returnTo}>
              {translate('common.back', 'Back')}
            </Link>
          </Button>
        ) : null}
        <DictionariesManager />
      </PageBody>
    </Page>
  )
}
