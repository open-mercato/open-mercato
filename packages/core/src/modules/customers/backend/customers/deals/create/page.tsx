"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DealForm, type DealFormSubmitPayload } from '../../../../components/detail/DealForm'
import { useCurrencyDictionary } from '../../../../components/detail/hooks/useCurrencyDictionary'

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
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = React.useMemo(
    () => resolveReturnTo(searchParams?.get('returnTo') ?? null),
    [searchParams],
  )
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  useCurrencyDictionary()

  const handleCancel = React.useCallback(() => {
    router.push(returnTo)
  }, [router, returnTo])

  const handleSubmit = React.useCallback(
    async ({ base, custom }: DealFormSubmitPayload) => {
      if (isSubmitting) return
      setIsSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          title: base.title,
          status: base.status ?? undefined,
          pipelineStage: base.pipelineStage ?? undefined,
          pipelineId: base.pipelineId ?? undefined,
          pipelineStageId: base.pipelineStageId ?? undefined,
          valueAmount: typeof base.valueAmount === 'number' ? base.valueAmount : undefined,
          valueCurrency: base.valueCurrency ?? undefined,
          probability: typeof base.probability === 'number' ? base.probability : undefined,
          expectedCloseAt: base.expectedCloseAt ?? undefined,
          description: base.description ?? undefined,
          personIds: Array.isArray(base.personIds) && base.personIds.length ? base.personIds : undefined,
          companyIds: Array.isArray(base.companyIds) && base.companyIds.length ? base.companyIds : undefined,
        }
        if (Object.keys(custom).length) payload.customFields = custom

        await createCrud('customers/deals', payload, {
          errorMessage: t('customers.deals.create.error', 'Failed to create deal.'),
        })
        flash(t('customers.people.detail.deals.success', 'Deal created.'), 'success')
        router.push(returnTo)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.deals.create.error', 'Failed to create deal.')
        flash(message, 'error')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, returnTo, router, t],
  )

  return (
    <Page>
      <PageBody>
        <DealForm
          mode="create"
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
          submitLabel={t('customers.deals.create.submit', 'Create deal')}
          embedded={false}
          title={t('customers.deals.create.title', 'Create deal')}
          backHref={returnTo}
        />
      </PageBody>
    </Page>
  )
}
