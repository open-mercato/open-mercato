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
          initialValues={{ addresses: [] as PersonFormValues['addresses'] }}
          entityId={E.customers.customer_person_profile}
          submitLabel={t('customers.people.form.submit')}
          cancelHref="/backend/customers/people"
          schema={formSchema}
          onSubmit={async (values) => {
            const addresses = Array.isArray(values.addresses) ? values.addresses : []
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

            if (newId && addresses.length) {
              const normalize = (value?: string | null) => {
                if (typeof value !== 'string') return undefined
                const trimmed = value.trim()
                return trimmed.length ? trimmed : undefined
              }
              for (const entry of addresses) {
                const normalizedLine1 = normalize(entry.addressLine1)
                if (!normalizedLine1) continue
                const body: Record<string, unknown> = {
                  entityId: newId,
                  ...(organizationId ? { organizationId } : {}),
                  addressLine1: normalizedLine1,
                  isPrimary: entry.isPrimary ?? false,
                }
                const name = normalize(entry.name)
                if (name !== undefined) body.name = name
                const purpose = normalize(entry.purpose)
                if (purpose !== undefined) body.purpose = purpose
                const line2 = normalize(entry.addressLine2)
                if (line2 !== undefined) body.addressLine2 = line2
                const buildingNumber = normalize(entry.buildingNumber)
                if (buildingNumber !== undefined) body.buildingNumber = buildingNumber
                const flatNumber = normalize(entry.flatNumber)
                if (flatNumber !== undefined) body.flatNumber = flatNumber
                const city = normalize(entry.city)
                if (city !== undefined) body.city = city
                const region = normalize(entry.region)
                if (region !== undefined) body.region = region
                const postalCode = normalize(entry.postalCode)
                if (postalCode !== undefined) body.postalCode = postalCode
                const country = normalize(entry.country)
                if (country !== undefined) body.country = country.toUpperCase()
                try {
                  const addressRes = await apiFetch('/api/customers/addresses', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                  })
                  if (!addressRes.ok) {
                    let message = t('customers.people.detail.addresses.error')
                    try {
                      const details = await addressRes.clone().json()
                      if (details && typeof details.error === 'string') message = details.error
                    } catch {}
                    flash(message, 'error')
                  }
                } catch (addressErr) {
                  const message =
                    addressErr instanceof Error && addressErr.message
                      ? addressErr.message
                      : t('customers.people.detail.addresses.error')
                  flash(message, 'error')
                }
              }
            }

            flash(t('customers.people.form.success'), 'success')
            if (newId) router.push(`/backend/customers/people/${newId}`)
            else router.push('/backend/customers/people')
          }}
        />
      </PageBody>
    </Page>
  )
}
