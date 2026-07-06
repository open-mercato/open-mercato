"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CreateDealForm } from '../../../../components/detail/create/CreateDealForm'

const DEFAULT_RETURN_TO = '/backend/customers/deals'

/**
 * Only honor `returnTo` when it points back into the deals area of the backoffice.
 * Without the prefix guard, this would be a textbook open-redirect: an attacker could
 * craft `/backend/customers/deals/create?returnTo=https://evil.example.com` and the
 * page would happily navigate the operator off-product after a successful save.
 */
function resolveReturnTo(value: string | null | undefined): string {
  if (!value) return DEFAULT_RETURN_TO
  if (!value.startsWith('/backend/customers/deals')) return DEFAULT_RETURN_TO
  return value
}

export default function CreateDealPage() {
  const searchParams = useSearchParams()
  const returnTo = React.useMemo(
    () => resolveReturnTo(searchParams?.get('returnTo') ?? null),
    [searchParams],
  )

  return (
    <Page>
      <PageBody>
        <CreateDealForm returnTo={returnTo} />
      </PageBody>
    </Page>
  )
}
