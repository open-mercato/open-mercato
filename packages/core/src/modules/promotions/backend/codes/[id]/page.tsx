'use client'

// Detail page for a `Code` (Release 4 PLAN.md Step 6.6, SPEC-055 "Promotional Codes
// (`/backend/codes`)"): "Code detail (`/backend/codes/[id]`): full form + generated codes
// panel (modal with paginated list of individual codes, active status,
// copy-to-clipboard)." Mirrors `promotions/backend/promotions/[id]/page.tsx`'s shape
// (`CrudForm` via the shared field helper, `params?.id` — NOT `useParams()`, see that
// file's own comment on the catch-all `/backend/[...slug]` route) plus a second,
// independent section below the form for the generated-codes panel.
//
// No dedicated `GET /api/promotions/codes/[id]` route exists (only `[id]/generate` and
// `[id]/generated`, Step 6.4) — the record loads via the list route's `?ids=` filter
// (`CRUD Multi-ID Filtering`, `packages/shared/AGENTS.md`), same convention as
// `warranty_claims/backend/warranty_claims/registrations/[id]/edit/page.tsx`.

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import {
  createCodeFormFields,
  createCodeFormGroups,
  createCodeFormSchema,
  type CodeFormValues,
} from '../../../components/codeFormFields'
import { GeneratedCodesModal } from '../../../components/GeneratedCodesModal'

type CodeDetailResponse = {
  id: string
  name: string
  type: 'static' | 'dynamic'
  code: string | null
  prefix: string | null
  suffix: string | null
  length: number | null
  amount: number | null
  generated: number
  used: number
  usage: 'single' | 'multiple' | 'unlimited'
  usageAmount: number | null
  usagePerCustomer: number | null
  active: boolean
  updatedAt: string
}

type ListResponse = { items: CodeDetailResponse[] }
type GenerateResponse = { jobId: string }

export default function CodeDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  // Same catch-all `/backend/[...slug]` routing caveat as `promotions/[id]/page.tsx`:
  // the dynamic segment arrives as a `params` prop, not via `useParams()`.
  const codeId = params?.id

  const [record, setRecord] = React.useState<CodeDetailResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [modalOpen, setModalOpen] = React.useState(false)

  const schema = React.useMemo(() => createCodeFormSchema(t), [t])
  const fields = React.useMemo(() => createCodeFormFields(t), [t])
  const groups = React.useMemo(() => createCodeFormGroups(t), [t])

  React.useEffect(() => {
    if (!codeId) return
    const id = codeId
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      setNotFound(false)
      try {
        const params = new URLSearchParams({ ids: id, page: '1', pageSize: '1' })
        const fallback: ListResponse = { items: [] }
        const call = await apiCall<ListResponse>(`/api/promotions/codes?${params.toString()}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          setLoadError(t('promotions.codes.detail.loadError', 'Failed to load the promotional code'))
          return
        }
        const item = (call.result ?? fallback).items[0] ?? null
        if (!item) {
          setNotFound(true)
          return
        }
        setRecord(item)
      } catch {
        if (!cancelled) setLoadError(t('promotions.codes.detail.loadError', 'Failed to load the promotional code'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [codeId, reloadToken, t])

  const handleGenerate = React.useCallback(async () => {
    if (!record) return
    setIsGenerating(true)
    try {
      const call = await apiCall<GenerateResponse>(`/api/promotions/codes/${encodeURIComponent(record.id)}/generate`, {
        method: 'POST',
      })
      if (!call.ok) {
        throw Object.assign(new Error('[internal] promotions.codes.generate failed'), {
          status: call.status,
          ...((call.result as Record<string, unknown> | null) ?? {}),
        })
      }
      flash(t('promotions.codes.list.flash.generateStarted', 'Code generation started'), 'success')
      // See `backend/codes/page.tsx`'s own comment: the route deliberately has no
      // `ProgressJob` — `Code.generated`/`Code.amount` ARE the progress signal — so poll
      // a few times to catch a fast-finishing run.
      for (const delay of [2000, 2000, 2000]) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        setReloadToken((v) => v + 1)
      }
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((v) => v + 1) })) return
      const serverMessage = (error as { error?: unknown } | null)?.error
      flash(
        typeof serverMessage === 'string' && serverMessage.trim()
          ? serverMessage
          : t('promotions.codes.list.flash.generateError', 'Could not start code generation'),
        'error',
      )
    } finally {
      setIsGenerating(false)
    }
  }, [record, t])

  if (!codeId) return null
  if (isLoading && !record) return <LoadingMessage label={t('promotions.codes.detail.loading', 'Loading promotional code...')} />
  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('promotions.codes.detail.notFound.title', 'Promotional code not found')}
        description={t('promotions.codes.detail.notFound.description', 'This code may have been deleted.')}
        backHref="/backend/codes"
        backLabel={t('promotions.codes.detail.notFound.backLabel', 'Back to promotional codes')}
      />
    )
  }
  if (loadError || !record) {
    return <ErrorMessage label={loadError ?? t('promotions.codes.detail.loadError', 'Failed to load the promotional code')} />
  }

  const initialValues: Partial<CodeFormValues> & { id: string; updatedAt: string } = {
    id: record.id,
    updatedAt: record.updatedAt,
    name: record.name,
    type: record.type,
    code: record.code,
    prefix: record.prefix,
    suffix: record.suffix,
    length: record.length,
    amount: record.amount,
    usage: record.usage,
    usageAmount: record.usageAmount,
    usagePerCustomer: record.usagePerCustomer,
    active: record.active,
  }

  const amount = record.amount ?? 0
  const percent = amount > 0 ? Math.min(100, Math.round((record.generated / amount) * 100)) : 0
  const isFull = amount > 0 && record.generated >= amount

  return (
    <Page>
      <PageBody className="space-y-8">
        <CrudForm<CodeFormValues>
          title={record.name}
          titleHeadingLevel={1}
          backHref="/backend/codes"
          cancelHref="/backend/codes"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          schema={schema}
          submitLabel={t('promotions.codes.form.submit', 'Save code')}
          onSubmit={async (values) => {
            const isStatic = values.type === 'static'
            const payload = {
              id: record.id,
              name: values.name,
              type: values.type,
              code: isStatic ? values.code ?? null : null,
              prefix: isStatic ? null : values.prefix ?? null,
              suffix: isStatic ? null : values.suffix ?? null,
              length: isStatic ? null : values.length ?? null,
              amount: isStatic ? null : values.amount ?? null,
              usage: values.usage,
              usageAmount: values.usage === 'multiple' ? values.usageAmount ?? null : null,
              usagePerCustomer: values.usagePerCustomer ?? null,
              active: values.active,
            }
            await updateCrud('promotions/codes', payload)
            flash(t('promotions.codes.form.success.update', 'Promotional code saved'), 'success')
            setReloadToken((v) => v + 1)
          }}
        />

        {record.type === 'dynamic' ? (
          <section className="space-y-3 rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">
              {t('promotions.codes.detail.generatedPanel.sectionTitle', 'Generated codes')}
            </h2>
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-48 space-y-1">
                <Progress value={percent} showValue />
                <span className="block text-sm text-muted-foreground">
                  {t('promotions.codes.list.pool.fraction', '{generated} / {amount}', {
                    generated: String(record.generated),
                    amount: String(amount),
                  })}
                </span>
              </div>
              <Button type="button" variant="outline" disabled={isGenerating || isFull} onClick={() => void handleGenerate()}>
                {isGenerating ? <Spinner className="size-4" /> : null}
                {isFull
                  ? t('promotions.codes.list.actions.generateFull', 'Pool full')
                  : t('promotions.codes.list.actions.generate', 'Generate')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setModalOpen(true)}>
                {t('promotions.codes.detail.generatedPanel.openButton', 'View generated codes')}
              </Button>
            </div>
          </section>
        ) : null}
      </PageBody>
      {record.type === 'dynamic' ? (
        <GeneratedCodesModal open={modalOpen} onOpenChange={setModalOpen} codeId={record.id} />
      ) : null}
    </Page>
  )
}
