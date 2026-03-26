"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildWebhookFormContentHeader,
  buildWebhookFormFields,
  buildWebhookFormGroups,
  createWebhookInitialValues,
  normalizeWebhookFormPayload,
  type WebhookFormValues,
} from '../../../components/webhook-form-config'
import { WebhookSecretPanel } from '../../../components/WebhookSecretPanel'

export default function CreateWebhookPage() {
  const router = useRouter()
  const t = useT()
  const [createdSecret, setCreatedSecret] = React.useState<string | null>(null)

  const fields = React.useMemo(() => buildWebhookFormFields(t), [t])
  const groups = React.useMemo(() => buildWebhookFormGroups(t), [t])
  const contentHeader = React.useMemo(() => buildWebhookFormContentHeader(t), [t])

  if (createdSecret) {
    return (
      <Page>
        <PageBody>
          <WebhookSecretPanel secret={createdSecret} onClose={() => router.push('/backend/webhooks')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('webhooks.form.title.create')}
          backHref="/backend/webhooks"
          fields={fields}
          groups={groups}
          initialValues={createWebhookInitialValues()}
          submitLabel={t('common.create')}
          cancelHref="/backend/webhooks"
          contentHeader={contentHeader}
          onSubmit={async (values) => {
            const payload = normalizeWebhookFormPayload(values as WebhookFormValues, t)
            const { result } = await createCrud<{ id?: string; secret?: string }>('webhooks', payload)
            const secret = typeof result?.secret === 'string' ? result.secret : null
            if (!secret) {
              throw new Error(t('webhooks.form.secretMissing'))
            }
            setCreatedSecret(secret)
            flash(t('webhooks.form.createSuccess'), 'success')
          }}
        />
      </PageBody>
    </Page>
  )
}
