'use client'

import * as React from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  loadCurrencyOptions,
  exchangeRateGroups,
  validateExchangeRateForm,
  buildExchangeRatePayload,
} from '../../../lib/exchangeRateFormConfig'

/**
 * Formats a Date object to YYYY-MM-DDTHH:MM format in local timezone
 * for use with datetime-local input
 */
function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

type ExchangeRateData = {
  id: string
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  date: string
  source: string | null
  type: string | null
  isActive: boolean
  organizationId: string
  tenantId: string
  updatedAt?: string | null
  updated_at?: string | null
}

export default function EditExchangeRatePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()

  const [exchangeRate, setExchangeRate] = React.useState<ExchangeRateData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const loadOptions = React.useCallback(
    (query?: string) => loadCurrencyOptions(apiCall, query),
    []
  )

  // Load exchange rate data
  React.useEffect(() => {
    async function loadExchangeRate() {
      try {
        const response = await apiCall<{ items: ExchangeRateData[] }>(`/api/currencies/exchange-rates?id=${params?.id}`)
        if (response.ok && response.result && response.result.items.length > 0) {
          setExchangeRate(response.result.items[0])
        } else if (response.ok) {
          setIsNotFound(true)
        } else {
          setError(t('exchangeRates.form.errors.load'))
        }
      } catch (err) {
        setError(t('exchangeRates.form.errors.load'))
      } finally {
        setLoading(false)
      }
    }
    loadExchangeRate()
  }, [params, t])

  const groups = React.useMemo(
    () => exchangeRateGroups(t, loadOptions),
    [t, loadOptions]
  )

  // Publish page-load record context to the AppShell-owned `backend:record:current`
  // mount so the enterprise record_locks widget resolves `currencies.exchange_rate`
  // + id explicitly. The resourceKind mirrors the CrudForm `versionHistory` so the
  // held lock matches the save-time conflict surface for the same exchange rate.
  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'currencies.exchange_rate',
      resourceId: exchangeRate?.id ?? null,
      updatedAt: exchangeRate?.updatedAt ?? exchangeRate?.updated_at ?? null,
      data: exchangeRate as Record<string, unknown> | null,
      path: pathname,
    }),
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('exchangeRates.form.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('exchangeRates.form.errors.notFound')}
            backHref="/backend/exchange-rates"
            backLabel={t('exchangeRates.form.actions.backToList', 'Back to exchange rates')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !exchangeRate) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('exchangeRates.form.errors.load')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('exchangeRates.edit.title')}
          backHref="/backend/exchange-rates"
          versionHistory={{ resourceKind: 'currencies.exchange_rate', resourceId: exchangeRate.id }}
          fields={[]}
          groups={groups}
          optimisticLockUpdatedAt={exchangeRate.updatedAt ?? exchangeRate.updated_at ?? null}
          initialValues={{
            fromCurrencyCode: exchangeRate.fromCurrencyCode,
            toCurrencyCode: exchangeRate.toCurrencyCode,
            rate: parseFloat(exchangeRate.rate),
            date: formatDateTimeLocal(new Date(exchangeRate.date)),
            source: exchangeRate.source || '',
            type: exchangeRate.type || '',
            isActive: exchangeRate.isActive,
          }}
          submitLabel={t('exchangeRates.form.action.save')}
          cancelHref="/backend/exchange-rates"
          onSubmit={async (values) => {
            const validated = validateExchangeRateForm(values, t)
            const payload = {
              id: exchangeRate.id,
              ...buildExchangeRatePayload(values, validated),
            }

            await updateCrud('currencies/exchange-rates', payload)

            flash(t('exchangeRates.flash.updated'), 'success')
            router.push('/backend/exchange-rates')
          }}
        />
      </PageBody>
    </Page>
  )
}
