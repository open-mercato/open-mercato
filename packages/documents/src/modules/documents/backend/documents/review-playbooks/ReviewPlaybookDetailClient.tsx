"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import {
  normalizeReviewPlaybookList,
  REVIEW_PLAYBOOKS_API,
  reviewPlaybookFormSchema,
  type ReviewPlaybookFormValues,
  type ReviewPlaybookRow,
} from './reviewPlaybookModel'
import { buildReviewPlaybookFields, reviewPlaybookPayload } from './reviewPlaybookFormFields'
import { RulesEditor } from './RulesEditor'
import { GuidanceDocuments } from './GuidanceDocuments'

const LIST_HREF = '/backend/documents/review-playbooks'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'ready'; playbook: ReviewPlaybookRow }

export function ReviewPlaybookDetailClient({ playbookId }: { playbookId: string }) {
  const t = useT()
  const router = useRouter()
  const fields = React.useMemo(() => buildReviewPlaybookFields(t), [t])
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' })
  const [reloadToken, setReloadToken] = React.useState(0)
  const [formKey, setFormKey] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ id: playbookId, page: '1', pageSize: '1' })
    void apiCall<unknown>(`${REVIEW_PLAYBOOKS_API}?${params.toString()}`, undefined, { fallback: { items: [] } })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setState({ kind: 'error' })
          return
        }
        const playbook = normalizeReviewPlaybookList(call.result).rows[0]
        setState(playbook ? { kind: 'ready', playbook } : { kind: 'missing' })
      })
      .catch(() => { if (!cancelled) setState({ kind: 'error' }) })
    return () => { cancelled = true }
  }, [playbookId, reloadToken])

  const refreshAfterSave = React.useCallback(() => {
    setFormKey((value) => value + 1)
    reload()
  }, [reload])

  if (state.kind === 'loading') return <LoadingMessage label={t('documents.reviewPlaybooks.detail.loading')} />
  if (state.kind === 'missing') {
    return (
      <RecordNotFoundState
        label={t('documents.reviewPlaybooks.detail.notFound')}
        description={t('documents.reviewPlaybooks.detail.notFoundDescription')}
        backHref={LIST_HREF}
        backLabel={t('documents.reviewPlaybooks.detail.back')}
      />
    )
  }
  if (state.kind === 'error') {
    return (
      <ErrorMessage
        label={t('documents.reviewPlaybooks.detail.loadError')}
        action={<Button type="button" size="sm" variant="outline" onClick={reload}>{t('documents.actions.retry')}</Button>}
      />
    )
  }

  const { playbook } = state
  const initialValues: Partial<ReviewPlaybookFormValues> & { id: string; updatedAt: string | null } = {
    id: playbook.id,
    updatedAt: playbook.updatedAt,
    code: playbook.code,
    name: playbook.name,
    description: playbook.description,
    instructions: playbook.instructions,
    isActive: playbook.isActive,
  }

  return (
    <Page>
      <PageBody className="space-y-8">
        <CrudForm<ReviewPlaybookFormValues>
          key={`${playbook.id}:${formKey}`}
          title={playbook.name}
          titleHeadingLevel={1}
          backHref={LIST_HREF}
          cancelHref={LIST_HREF}
          entityId={DOCUMENTS_ENTITY_IDS.documentReviewPlaybook}
          fields={fields}
          initialValues={initialValues}
          schema={reviewPlaybookFormSchema}
          submitLabel={t('documents.reviewPlaybooks.actions.save')}
          extraActions={(
            <span className="text-sm text-muted-foreground" data-testid="documents-review-playbook-version">
              {t('documents.reviewPlaybooks.versionLabel', { version: playbook.version })}
            </span>
          )}
          onSubmit={async (values) => {
            await updateCrud('documents/review-playbooks', { id: playbook.id, ...reviewPlaybookPayload(values) }, {
              errorMessage: t('documents.reviewPlaybooks.form.saveError'),
            })
            flash(t('documents.reviewPlaybooks.form.saved'), 'success')
            refreshAfterSave()
          }}
          onDelete={async () => {
            await deleteCrud('documents/review-playbooks', playbook.id, {
              errorMessage: t('documents.reviewPlaybooks.delete.error'),
            })
            flash(t('documents.reviewPlaybooks.delete.success'), 'success')
            router.push(LIST_HREF)
          }}
        />
        <RulesEditor playbookId={playbook.id} onChanged={reload} />
        <GuidanceDocuments playbookId={playbook.id} onChanged={reload} />
      </PageBody>
    </Page>
  )
}

export default ReviewPlaybookDetailClient
