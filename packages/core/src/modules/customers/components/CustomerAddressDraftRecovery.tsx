'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'

export function CustomerAddressDraftRecovery({
  kind,
  customerId,
  unconfirmed,
  onConfirm,
}: {
  kind: 'people' | 'companies'
  customerId: string
  unconfirmed: boolean
  onConfirm: (outcome: 'saved' | 'missing') => void
}) {
  const t = useT()
  return (
    <Alert status="warning" style="lighter" footer={unconfirmed ? (
      <>
        <LinkButton asChild size="sm">
          <a href={`/backend/customers/${kind}/${encodeURIComponent(customerId)}?tab=addresses`} target="_blank" rel="noreferrer">
            {t('customers.people.detail.addresses.checkAddressBook')}
          </a>
        </LinkButton>
        <Button type="button" variant="outline" size="sm" onClick={() => onConfirm('saved')}>
          {t('customers.people.detail.addresses.confirmAddressSaved')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onConfirm('missing')}>
          {t('customers.people.detail.addresses.confirmAddressMissing')}
        </Button>
      </>
    ) : undefined}>
      <AlertDescription>{t(unconfirmed ? 'customers.people.detail.addresses.saveUnconfirmed' : 'customers.people.detail.addresses.retryPending')}</AlertDescription>
    </Alert>
  )
}
