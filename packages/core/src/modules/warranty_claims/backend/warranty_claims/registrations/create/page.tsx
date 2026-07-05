"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildRegistrationPayload,
  useRegistrationFormConfig,
  type RegistrationFormValues,
} from '../registrationForm'

export default function CreateWarrantyClaimRegistrationPage() {
  const t = useT()
  const router = useRouter()
  const { fields, groups } = useRegistrationFormConfig(t)

  const initialValues = React.useMemo<Partial<RegistrationFormValues>>(() => ({
    source: 'manual',
    coverageType: 'standard',
    warrantyMonths: 12,
  }), [])

  return (
    <Page>
      <PageBody>
        <CrudForm<RegistrationFormValues>
          title={t('warranty_claims.registrations.create.title', 'New warranty registration')}
          backHref="/backend/warranty_claims/registrations"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('warranty_claims.registrations.form.submit.create', 'Create registration')}
          cancelHref="/backend/warranty_claims/registrations"
          entityId="warranty_claims:warranty_claim_registration"
          onSubmit={async (values) => {
            const payload = buildRegistrationPayload(values)
            const call = await createCrud<{ id?: string | null }>('warranty_claims/registrations', payload, {
              errorMessage: t('warranty_claims.registrations.create.error.save', 'Failed to create warranty registration.'),
            })
            flash(t('warranty_claims.registrations.create.success', 'Warranty registration created.'), 'success')
            const id = call.result?.id
            router.push(id ? `/backend/warranty_claims/registrations/${id}/edit` : '/backend/warranty_claims/registrations')
          }}
        />
      </PageBody>
    </Page>
  )
}
