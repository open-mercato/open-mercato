"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { DealForm, type DealFormSubmitPayload, type DealFormBaseValues } from '../../../../components/detail/DealForm'
import { useCurrencyDictionary } from '../../../../components/detail/hooks/useCurrencyDictionary'

type DealInitialValues = Partial<DealFormBaseValues & Record<string, unknown>> & { id?: string }

function mapDealForForm(item: Record<string, unknown>): DealInitialValues | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null

  const parseNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed.length) return null
      const parsed = Number(trimmed)
      return Number.isNaN(parsed) ? null : parsed
    }
    return null
  }

  const toIdList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const set = new Set<string>()
    value.forEach((entry) => {
      if (typeof entry !== 'string') return
      const trimmed = entry.trim()
      if (!trimmed.length) return
      set.add(trimmed)
    })
    return Array.from(set)
  }

  const parseAssociations = (value: unknown): { id: string; label: string }[] => {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const result: { id: string; label: string }[] = []
    value.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const data = entry as Record<string, unknown>
      const assocId = typeof data.id === 'string' ? data.id : null
      if (!assocId || seen.has(assocId)) return
      const label = typeof data.label === 'string' ? data.label : ''
      seen.add(assocId)
      result.push({ id: assocId, label })
    })
    return result
  }

  const expectedCloseAt =
    typeof item.expected_close_at === 'string' && item.expected_close_at.trim().length
      ? item.expected_close_at
      : null

  const valueCurrency =
    typeof item.value_currency === 'string' && item.value_currency.trim().length
      ? item.value_currency.trim().toUpperCase()
      : undefined

  const customEntries: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('cf_')) {
      customEntries[key] = value
    }
  }

  const personIds =
    toIdList(
      Array.isArray((item as any).personIds)
        ? (item as any).personIds
        : (item as any).person_ids,
    )
  const companyIds =
    toIdList(
      Array.isArray((item as any).companyIds)
        ? (item as any).companyIds
        : (item as any).company_ids,
    )

  return {
    id,
    title: typeof item.title === 'string' ? item.title : '',
    status: typeof item.status === 'string' ? item.status : '',
    pipelineStage: typeof item.pipeline_stage === 'string' ? item.pipeline_stage : '',
    valueAmount: parseNumber(item.value_amount),
    valueCurrency,
    probability: parseNumber(item.probability),
    expectedCloseAt,
    description: typeof item.description === 'string' ? item.description : '',
    personIds,
    companyIds,
    people: parseAssociations((item as any).people),
    companies: parseAssociations((item as any).companies),
    ...customEntries,
  }
}

export default function EditDealPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = params?.id
  const [initialValues, setInitialValues] = React.useState<DealInitialValues | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  useCurrencyDictionary()

  React.useEffect(() => {
    if (!id) {
      setLoadError(t('customers.deals.edit.missingId', 'Deal id is required.'))
      setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const search = new URLSearchParams()
        search.set('id', id)
        search.set('page', '1')
        search.set('pageSize', '1')
        const res = await apiFetch(`/api/customers/deals?${search.toString()}`)
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.deals.edit.errorLoad', 'Failed to load deal.')
          throw new Error(message)
        }
        const items = Array.isArray(payload?.items) ? payload.items : []
        const mapped = items.length ? mapDealForForm(items[0] as Record<string, unknown>) : null
        if (cancelled) return
        if (!mapped) {
          setInitialValues(null)
          setLoadError(t('customers.deals.edit.notFound', 'Deal not found.'))
          return
        }
        setInitialValues(mapped)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.deals.edit.errorLoad', 'Failed to load deal.')
        setLoadError(message)
        flash(message, 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, reloadToken, t])

  const handleCancel = React.useCallback(() => {
    router.push('/backend/customers/deals')
  }, [router])

  const handleSubmit = React.useCallback(
    async ({ base, custom }: DealFormSubmitPayload) => {
      if (!id || isSubmitting) return
      setIsSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          id,
          title: base.title,
          status: base.status ?? undefined,
          pipelineStage: base.pipelineStage ?? undefined,
          valueAmount:
            typeof base.valueAmount === 'number' ? base.valueAmount : undefined,
          valueCurrency: base.valueCurrency ?? undefined,
          probability:
            typeof base.probability === 'number' ? base.probability : undefined,
          expectedCloseAt: base.expectedCloseAt ?? undefined,
          description: base.description ?? undefined,
          personIds: base.personIds && base.personIds.length ? base.personIds : undefined,
          companyIds: base.companyIds && base.companyIds.length ? base.companyIds : undefined,
        }
        if (Object.keys(custom).length) payload.customFields = custom

        const res = await apiFetch('/api/customers/deals', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const responseBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof responseBody?.error === 'string'
              ? responseBody.error
              : t('customers.deals.edit.errorUpdate', 'Failed to save deal.')
          throw new Error(message)
        }
        flash(t('customers.people.detail.deals.updateSuccess', 'Deal updated.'), 'success')
        setReloadToken((token) => token + 1)
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.deals.edit.errorUpdate', 'Failed to save deal.')
        flash(message, 'error')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setIsSubmitting(false)
      }
    },
    [id, isSubmitting, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!id || isDeleting) return
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            t(
              'customers.people.detail.deals.deleteConfirm',
              'Delete this deal? This action cannot be undone.',
            ),
          )
    if (!confirmed) return

    setIsDeleting(true)
    try {
      const res = await apiFetch('/api/customers/deals', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const responseBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          typeof responseBody?.error === 'string'
            ? responseBody.error
            : t('customers.people.detail.deals.deleteError', 'Failed to delete deal.')
        throw new Error(message)
      }
      flash(t('customers.people.detail.deals.deleteSuccess', 'Deal deleted.'), 'success')
      router.push('/backend/customers/deals')
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('customers.people.detail.deals.deleteError', 'Failed to delete deal.')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [id, isDeleting, router, t])

  const showForm = !isLoading && !loadError && initialValues

  return (
    <Page>
      <PageBody>
        <div className="max-w-3xl">
          {isLoading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : loadError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </div>
          ) : null}
          {showForm ? (
            <DealForm
              mode="edit"
              initialValues={initialValues ?? undefined}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              onDelete={handleDelete}
              isSubmitting={isSubmitting || isDeleting}
            />
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}
