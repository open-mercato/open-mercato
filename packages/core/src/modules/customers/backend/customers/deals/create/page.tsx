"use client"

import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CreateDealForm } from '../../../../components/detail/create/CreateDealForm'
import { resolveReturnTo } from '../../../../lib/returnTo'

const DEFAULT_RETURN_TO = '/backend/customers/deals'

export default function CreateDealPage() {
  const searchParams = useSearchParams()
  const destination = resolveReturnTo(searchParams?.get('returnTo'))
  const returnTo = destination?.startsWith(DEFAULT_RETURN_TO) ? destination : DEFAULT_RETURN_TO

  return (
    <Page>
      <PageBody>
        <CreateDealForm returnTo={returnTo} />
      </PageBody>
    </Page>
  )
}
