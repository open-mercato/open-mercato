'use client'

// Create page (Step 1.7, SPEC-055 §UI/UX "Promotion Form"). Three panels — Info,
// Settings, Exclusions — via the shared `CrudForm` config in `promotionFormFields.tsx`.
// No "Rules & Benefits" tree here: `promotions.promotion.create` (Step 1.3) always
// creates a fresh promotion with an empty root rule group, so there is nothing to edit
// in a tree builder until the promotion exists — the spec's own flow is "create, then
// navigate to the detail page" (§UI/UX "Promotion Form").

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  createPromotionFormFields,
  createPromotionFormGroups,
  createPromotionFormSchema,
  type PromotionFormValues,
} from '../../../components/promotionFormFields'

type ListTotalResponse = { total: number }

export default function CreatePromotionPage() {
  const t = useT()
  const router = useRouter()

  const schema = React.useMemo(() => createPromotionFormSchema(t), [t])
  const fields = React.useMemo(() => createPromotionFormFields(t), [t])
  const groups = React.useMemo(() => createPromotionFormGroups(t), [t])
  const initialValues = React.useMemo<Partial<PromotionFormValues>>(
    () => ({
      active: false,
      cumulative: true,
      tags: [],
      excludedTags: [],
      excludeFlags: {},
      eligibleCurrencies: [],
      maxBudget: null,
      budgetCurrency: null,
    }),
    [],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<PromotionFormValues>
          title={t('promotions.form.title.create', 'Create promotion')}
          titleHeadingLevel={1}
          backHref="/backend/promotions"
          cancelHref="/backend/promotions"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          schema={schema}
          submitLabel={t('promotions.form.submit', 'Save promotion')}
          onSubmit={async (values) => {
            // §Data Models: `Promotion.order` has no server-side default — a brand new
            // promotion is appended after every existing one, matching the list page's
            // own ascending `order` sort (`backend/promotions/page.tsx`).
            const totalCall = await apiCall<ListTotalResponse>('/api/promotions?page=1&pageSize=1', undefined, {
              fallback: { total: 0 },
            })
            const order = totalCall.ok ? totalCall.result?.total ?? 0 : 0

            const payload = {
              name: values.name,
              description: values.description ?? null,
              order,
              active: values.active,
              startsAt: values.startsAt ?? null,
              endsAt: values.endsAt ?? null,
              cumulative: values.cumulative,
              tags: values.tags ?? [],
              excludedTags: values.excludedTags ?? [],
              excludeFlags: { excludePromotionalPrices: values.excludeFlags?.excludePromotionalPrices ?? false },
              eligibleCurrencies: values.eligibleCurrencies ?? [],
              maxBudget: values.maxBudget ?? null,
              budgetCurrency: values.budgetCurrency ?? null,
            }

            const { result } = await createCrud<{ id: string | null }>('promotions', payload)
            flash(t('promotions.form.success.create', 'Promotion created'), 'success')
            if (result?.id) router.push(`/backend/promotions/${result.id}`)
            else router.push('/backend/promotions')
          }}
        />
      </PageBody>
    </Page>
  )
}
