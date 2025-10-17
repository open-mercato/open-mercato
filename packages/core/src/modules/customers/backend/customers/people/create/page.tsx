"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  buildPersonPayload,
  createPersonFormFields,
  createPersonFormGroups,
  createPersonFormSchema,
  type PersonFormValues,
} from '../../../../components/formConfig'

export default function CreatePersonPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId } = useOrganizationScopeDetail()

  const formSchema = React.useMemo(() => createPersonFormSchema(), [])
  const fields = React.useMemo(() => createPersonFormFields(t), [t])
  const groups = React.useMemo(() => createPersonFormGroups(t), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<PersonFormValues>
          title={t('customers.people.create.title')}
          backHref="/backend/customers/people"
          fields={fields}
          groups={groups}
          entityId={E.customers.customer_entity}
          submitLabel={t('customers.people.form.submit')}
          cancelHref="/backend/customers/people"
          schema={formSchema}
          onSubmit={async (values) => {
            let payload: Record<string, unknown>
            try {
              payload = buildPersonPayload(values, organizationId)
            } catch (err) {
              if (err instanceof Error && err.message === 'DISPLAY_NAME_REQUIRED') {
                const message = t('customers.people.form.displayName.error')
                throw { message, fieldErrors: { displayName: message } }
              }
              throw err
            }

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
            const newId =
              created && typeof created.id === 'string'
                ? created.id
                : (typeof created?.entityId === 'string' ? created.entityId : null)

            flash(t('customers.people.form.success'), 'success')
            if (newId) router.push(`/backend/customers/people/${newId}`)
            else router.push('/backend/customers/people')
          }}
        />
      </PageBody>
    </Page>
  )
}
