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
import { useParams } from 'next/navigation'
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
  updatedAt: string
}

export default function PromotionDetailPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const promotionId = params?.id

  const [record, setRecord] = React.useState<PromotionDetailResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const schema = React.useMemo(() => createPromotionFormSchema(t), [t])
  const fields = React.useMemo(() => createPromotionFormFields(t), [t])
  const groups = React.useMemo(() => createPromotionFormGroups(t), [t])

  React.useEffect(() => {
    if (!promotionId) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      setNotFound(false)
      try {
        const call = await apiCall<PromotionDetailResponse>(`/api/promotions/${encodeURIComponent(promotionId)}`)
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
  }, [promotionId, t])

  if (!promotionId) return null
  if (isLoading) return <LoadingMessage label={t('promotions.detail.loading', 'Loading promotion...')} />
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
            }
            await updateCrud('promotions', payload)
            flash(t('promotions.form.success.update', 'Promotion saved'), 'success')
          }}
        />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t('promotions.tree.title', 'Rules & Benefits')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('promotions.tree.description', 'Define when this promotion activates and what it does.')}
          </p>
          <RuleTreeBuilder promotionId={record.id} />
        </section>
      </PageBody>
    </Page>
  )
}
