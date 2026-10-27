'use client'

// Detail page (Step 1.7, SPEC-055 §UI/UX "Promotion Form"): the same three metadata
// panels as the create page (Info, Settings, Exclusions) via `CrudForm`, plus the
// fourth panel — "Rules & Benefits" — rendered by `RuleTreeBuilder` below it. The two
// save surfaces are deliberately decoupled (CrudForm PUTs promotion metadata via
// `promotions.promotion.update`; `RuleTreeBuilder` PUTs the tree via
// `promotions.rule_tree.reconcile`, Step 1.4) — mirroring the pattern
// `customers/backend/customers/people-v2/[id]/page.tsx` uses for an embedded `CrudForm`
// alongside a fully custom section with its own independent save.

import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  createPromotionFormFields,
  createPromotionFormGroups,
  createPromotionFormSchema,
  type PromotionFormValues,
} from '../../../components/promotionFormFields'
import { RuleTreeBuilder } from '../../../components/RuleTreeBuilder'

type PromotionDetailResponse = {
  id: string
  name: string
  description: string | null
  active: boolean
  startsAt: string | null
  endsAt: string | null
  cumulative: boolean
  tags: string[]
  excludedTags: string[]
  excludeFlags: Record<string, boolean>
  eligibleCurrencies: string[]
  maxBudget: string | null
  budgetCurrency: string | null
  updatedAt: string
}

export default function PromotionDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  // This app routes every backend page through a single catch-all
  // `/backend/[...slug]` route (`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`),
  // which resolves the dynamic segment from its own manifest and passes it down
  // as a `params` prop — NOT as a Next.js router param. `useParams()` from
  // `next/navigation` only ever sees `{ slug: [...] }` here, never `{ id }`,
  // which is why using it made this page always render null (`people-v2/[id]`
  // is the house precedent for the `params` prop pattern).
  const promotionId = params?.id

  const [record, setRecord] = React.useState<PromotionDetailResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  // Bumped after a successful CrudForm save so `record.updatedAt` (and therefore
  // `initialValues.updatedAt`) reflects the server's post-save version, same pattern as
  // `codes/[id]/page.tsx`'s own `reloadToken`. Fixes the stale-version 409 a second save
  // used to get, since `record` previously never refreshed after the first save.
  const [reloadToken, setReloadToken] = React.useState(0)
  // Bumped after `RuleTreeBuilder`'s own tree save, so the metadata `CrudForm` above also
  // picks up the new `updatedAt` the tree save just set on the promotion.
  const [treeVersionToken, setTreeVersionToken] = React.useState(0)

  const schema = React.useMemo(() => createPromotionFormSchema(t), [t])
  const fields = React.useMemo(() => createPromotionFormFields(t), [t])
  const groups = React.useMemo(() => createPromotionFormGroups(t), [t])

  React.useEffect(() => {
    if (!promotionId) return
    const id = promotionId
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      setNotFound(false)
      try {
        const call = await apiCall<PromotionDetailResponse>(`/api/promotions/${encodeURIComponent(id)}`)
        if (cancelled) return
        if (!call.ok) {
          if (call.status === 404) setNotFound(true)
          else setLoadError(t('promotions.detail.loadError', 'Failed to load the promotion'))
          return
        }
        setRecord(call.result ?? null)
      } catch {
        if (!cancelled) setLoadError(t('promotions.detail.loadError', 'Failed to load the promotion'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [promotionId, reloadToken, treeVersionToken, t])

  if (!promotionId) return null
  // Only block on the FIRST load. A reload triggered by `reloadToken`/`treeVersionToken`
  // after a save must not unmount the form — `record` is already populated, so it stays
  // rendered (with its pre-refresh values) while the refreshed version loads in the
  // background, same as `codes/[id]/page.tsx`'s own `isLoading && !record` guard.
  if (isLoading && !record) return <LoadingMessage label={t('promotions.detail.loading', 'Loading promotion...')} />
  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('promotions.detail.notFound.title', 'Promotion not found')}
        description={t('promotions.detail.notFound.description', 'This promotion may have been deleted.')}
        backHref="/backend/promotions"
        backLabel={t('promotions.detail.notFound.backLabel', 'Back to promotions')}
      />
    )
  }
  if (loadError || !record) return <ErrorMessage label={loadError ?? t('promotions.detail.loadError', 'Failed to load the promotion')} />

  const initialValues: Partial<PromotionFormValues> & { id: string; updatedAt: string } = {
    id: record.id,
    updatedAt: record.updatedAt,
    name: record.name,
    description: record.description,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    active: record.active,
    cumulative: record.cumulative,
    tags: record.tags,
    excludedTags: record.excludedTags,
    excludeFlags: { excludePromotionalPrices: record.excludeFlags?.excludePromotionalPrices ?? false },
    eligibleCurrencies: record.eligibleCurrencies ?? [],
    maxBudget: record.maxBudget ?? null,
    budgetCurrency: record.budgetCurrency ?? null,
  }

  return (
    <Page>
      <PageHeader
        title={record.name}
        description={t('promotions.detail.description', 'Edit promotion details and its rule tree.')}
      />
      <PageBody className="space-y-8">
        <CrudForm<PromotionFormValues>
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          schema={schema}
          submitLabel={t('promotions.form.submit', 'Save promotion')}
          cancelHref="/backend/promotions"
          onSubmit={async (values) => {
            const payload = {
              id: record.id,
              name: values.name,
              description: values.description ?? null,
              startsAt: values.startsAt ?? null,
              endsAt: values.endsAt ?? null,
              active: values.active,
              cumulative: values.cumulative,
              tags: values.tags ?? [],
              excludedTags: values.excludedTags ?? [],
              excludeFlags: { excludePromotionalPrices: values.excludeFlags?.excludePromotionalPrices ?? false },
              eligibleCurrencies: values.eligibleCurrencies ?? [],
              maxBudget: values.maxBudget ?? null,
              budgetCurrency: values.budgetCurrency ?? null,
            }
            await updateCrud('promotions', payload)
            flash(t('promotions.form.success.update', 'Promotion saved'), 'success')
            setReloadToken((value) => value + 1)
          }}
        />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t('promotions.tree.title', 'Rules & Benefits')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('promotions.tree.description', 'Define when this promotion activates and what it does.')}
          </p>
          <RuleTreeBuilder
            promotionId={record.id}
            refreshSignal={reloadToken}
            onSaved={() => setTreeVersionToken((value) => value + 1)}
          />
        </section>
      </PageBody>
    </Page>
  )
}
