"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  buildWebhookFormFields,
  buildWebhookFormGroups,
  createWebhookInitialValues,
  normalizeWebhookFormPayload,
  type WebhookFormValues,
} from '../form-config'

export default function CreateWebhookPage() {
  const router = useRouter()
  const t = useT()
  const [createdSecret, setCreatedSecret] = React.useState<string | null>(null)

  const fields = React.useMemo(() => buildWebhookFormFields(t), [t])
  const groups = React.useMemo(() => buildWebhookFormGroups(t), [t])

  const handleCopySecret = React.useCallback(async () => {
    if (!createdSecret) return
    await navigator.clipboard.writeText(createdSecret)
    flash(t('webhooks.form.secretCopied'), 'success')
  }, [createdSecret, t])

  if (createdSecret) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center">
            <div className="w-full max-w-2xl rounded-xl border bg-card shadow-sm">
              <div className="border-b p-6">
                <h1 className="text-lg font-semibold leading-7">{t('webhooks.form.secret')}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{t('webhooks.form.secretVisibleOnce')}</p>
              </div>
              <div className="space-y-4 p-6">
                <div className="rounded-md border bg-muted/40 p-4 font-mono text-sm break-all">
                  {createdSecret}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{t('webhooks.form.secretHint')}</span>
                  <span>{t('webhooks.form.secretVisibleOnce')}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => { void handleCopySecret() }}>
                    {t('webhooks.form.secretCopy')}
                  </Button>
                  <Button type="button" onClick={() => router.push('/backend/webhooks')}>
                    {t('common.close')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
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
