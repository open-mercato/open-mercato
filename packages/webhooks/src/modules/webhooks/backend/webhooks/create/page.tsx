"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function CreateWebhookPage() {
  const router = useRouter()
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', type: 'text', label: t('webhooks.form.name'), placeholder: t('webhooks.form.namePlaceholder'), required: true },
    { id: 'description', type: 'textarea', label: t('webhooks.form.description'), placeholder: t('webhooks.form.descriptionPlaceholder') },
    { id: 'url', type: 'text', label: t('webhooks.form.url'), placeholder: t('webhooks.form.urlPlaceholder'), description: t('webhooks.form.urlHint'), required: true },
    { id: 'subscribedEvents', type: 'text', label: t('webhooks.form.events'), placeholder: 'customers.person.created, sales.order.created', description: t('webhooks.form.eventsHint'), required: true },
    { id: 'httpMethod', type: 'select', label: t('webhooks.form.httpMethod'), options: [
      { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' },
      { value: 'PATCH', label: 'PATCH' },
    ]},
    { id: 'maxRetries', type: 'number', label: t('webhooks.form.maxRetries'), description: t('webhooks.form.maxRetriesHint') },
    { id: 'timeoutMs', type: 'number', label: t('webhooks.form.timeoutMs'), description: t('webhooks.form.timeoutMsHint') },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'general', title: t('webhooks.form.group.general'), column: 1, fields: ['name', 'description', 'url'] },
    { id: 'events', title: t('webhooks.form.group.events'), column: 1, fields: ['subscribedEvents'] },
    { id: 'delivery', title: t('webhooks.form.group.delivery'), column: 2, fields: ['httpMethod', 'maxRetries', 'timeoutMs'] },
  ], [t])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('webhooks.form.title.create')}
          backHref="/backend/webhooks"
          fields={fields}
          groups={groups}
          initialValues={{
            name: '',
            description: '',
            url: '',
            subscribedEvents: '',
            httpMethod: 'POST',
            maxRetries: 10,
            timeoutMs: 15000,
          }}
          submitLabel={t('common.create')}
          cancelHref="/backend/webhooks"
          onSubmit={async (values) => {
            const eventsRaw = typeof values.subscribedEvents === 'string' ? values.subscribedEvents : ''
            const subscribedEvents = eventsRaw.split(',').map((event: string) => event.trim()).filter(Boolean)

            const payload = {
              name: values.name,
              description: values.description || null,
              url: values.url,
              subscribedEvents,
              httpMethod: values.httpMethod || 'POST',
              maxRetries: values.maxRetries ? Number(values.maxRetries) : 10,
              timeoutMs: values.timeoutMs ? Number(values.timeoutMs) : 15000,
            }

            await createCrud<{ id?: string }>('webhooks/webhooks', payload)
            flash(t('webhooks.form.createSuccess'), 'success')
            router.push('/backend/webhooks')
          }}
        />
      </PageBody>
    </Page>
  )
}
