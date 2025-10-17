"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type CreatePersonFormValues = {
  displayName: string
  description?: string
  primaryEmail?: string
  primaryPhone?: string
  status?: string
  lifecycleStage?: string
  source?: string
  firstName?: string
  lastName?: string
  jobTitle?: string
} & Record<string, unknown>

export default function CreatePersonPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId } = useOrganizationScopeDetail()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'displayName', label: t('customers.people.form.displayName'), type: 'text', required: true },
    { id: 'firstName', label: t('customers.people.form.firstName'), type: 'text' },
    { id: 'lastName', label: t('customers.people.form.lastName'), type: 'text' },
    { id: 'jobTitle', label: t('customers.people.form.jobTitle'), type: 'text' },
    { id: 'primaryEmail', label: t('customers.people.form.primaryEmail'), type: 'text' },
    { id: 'primaryPhone', label: t('customers.people.form.primaryPhone'), type: 'text' },
    { id: 'status', label: t('customers.people.form.status'), type: 'text' },
    { id: 'lifecycleStage', label: t('customers.people.form.lifecycleStage'), type: 'text' },
    { id: 'source', label: t('customers.people.form.source'), type: 'text' },
    { id: 'description', label: t('customers.people.form.description'), type: 'textarea' },
  ], [t])

  const groups: CrudFormGroup[] = [
    {
      id: 'details',
      title: t('customers.people.form.groups.details'),
      column: 1,
      fields: ['displayName', 'firstName', 'lastName', 'jobTitle', 'primaryEmail', 'primaryPhone', 'status', 'lifecycleStage', 'source'],
    },
    {
      id: 'notes',
      title: t('customers.people.form.groups.notes'),
      column: 2,
      fields: ['description'],
    },
    {
      id: 'customFields',
      title: t('customers.people.form.groups.custom'),
      column: 2,
      kind: 'customFields',
    },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm<CreatePersonFormValues>
          title={t('customers.people.create.title')}
          backHref="/backend/customers/people"
          fields={fields}
          groups={groups}
          entityId={E.customers.customer_entity}
          submitLabel={t('customers.people.form.submit')}
          cancelHref="/backend/customers/people"
          onSubmit={async (values) => {
            const customFields: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(values)) {
              if (key.startsWith('cf_')) {
                customFields[key.slice(3)] = value
              }
            }

            const payload: Record<string, unknown> = {
              displayName: values.displayName,
              description: values.description ?? undefined,
              primaryEmail: values.primaryEmail ?? undefined,
              primaryPhone: values.primaryPhone ?? undefined,
              status: values.status ?? undefined,
              lifecycleStage: values.lifecycleStage ?? undefined,
              source: values.source ?? undefined,
              firstName: values.firstName ?? undefined,
              lastName: values.lastName ?? undefined,
              jobTitle: values.jobTitle ?? undefined,
            }

            if (Object.keys(customFields).length) {
              for (const [key, value] of Object.entries(customFields)) {
                payload[`cf_${key}`] = value
              }
            }

            if (organizationId) payload.organizationId = organizationId

            const res = await apiFetch('/api/customers/people', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })

            if (!res.ok) {
              let message = t('customers.people.form.error.create')
              try {
                const data = await res.clone().json()
                if (data && typeof data.error === 'string') message = data.error
              } catch {}
              throw new Error(message)
            }

            const created = await res.json().catch(() => null)
            const newId = created && typeof created.id === 'string' ? created.id : (typeof created?.entityId === 'string' ? created.entityId : null)
            flash(t('customers.people.form.success'), 'success')
            if (newId) router.push(`/backend/customers/people/${newId}`)
            else router.push('/backend/customers/people')
          }}
        />
      </PageBody>
    </Page>
  )
}
