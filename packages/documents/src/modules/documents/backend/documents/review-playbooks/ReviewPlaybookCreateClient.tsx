"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { reviewPlaybookFormSchema, type ReviewPlaybookFormValues } from './reviewPlaybookModel'
import { buildReviewPlaybookFields, reviewPlaybookPayload } from './reviewPlaybookFormFields'

const LIST_HREF = '/backend/documents/review-playbooks'

export function ReviewPlaybookCreateClient() {
  const t = useT()
  const router = useRouter()
  const fields = React.useMemo(() => buildReviewPlaybookFields(t), [t])
  const initialValues = React.useMemo<Partial<ReviewPlaybookFormValues>>(() => ({ isActive: true }), [])
  return (
    <Page>
      <PageBody>
        <CrudForm<ReviewPlaybookFormValues>
          title={t('documents.reviewPlaybooks.create.title')}
          titleHeadingLevel={1}
          backHref={LIST_HREF}
          cancelHref={LIST_HREF}
          entityId={DOCUMENTS_ENTITY_IDS.documentReviewPlaybook}
          fields={fields}
          initialValues={initialValues}
          schema={reviewPlaybookFormSchema}
          submitLabel={t('documents.reviewPlaybooks.actions.create')}
          onSubmit={async (values) => {
            const { result } = await createCrud<{ id?: string }>('documents/review-playbooks', reviewPlaybookPayload(values), {
              errorMessage: t('documents.reviewPlaybooks.form.saveError'),
            })
            flash(t('documents.reviewPlaybooks.form.created'), 'success')
            router.push(result?.id ? `${LIST_HREF}/${encodeURIComponent(result.id)}` : LIST_HREF)
          }}
        />
      </PageBody>
    </Page>
  )
}

export default ReviewPlaybookCreateClient
