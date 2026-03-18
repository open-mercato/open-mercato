'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  loadCurrencyOptions,
  exchangeRateGroups,
  validateExchangeRateForm,
  buildExchangeRatePayload,
} from '../../../lib/exchangeRateFormConfig'

export default function CreateExchangeRatePage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const loadOptions = React.useCallback(
    (query?: string) => loadCurrencyOptions(apiCall, query),
    []
  )

  const groups = React.useMemo(
    () => exchangeRateGroups(t, loadOptions),
    [t, loadOptions]
  )

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('exchangeRates.create.title')}
          backHref="/backend/exchange-rates"
          fields={[]}
          groups={groups}
          submitLabel={t('exchangeRates.form.action.create')}
          cancelHref="/backend/exchange-rates"
          onSubmit={async (values) => {
            const validated = validateExchangeRateForm(values, t)
            const payload = {
              organizationId,
              tenantId,
              ...buildExchangeRatePayload(values, validated),
            }

            await createCrud('currencies/exchange-rates', payload)

            flash(t('exchangeRates.flash.created'), 'success')
            router.push('/backend/exchange-rates')
          }}
        />
      </PageBody>
    </Page>
  )
}
