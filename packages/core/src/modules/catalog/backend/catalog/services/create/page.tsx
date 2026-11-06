"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildServicePayload,
  createServiceInitialValues,
  ServiceForm,
  type ServiceFormValues,
} from '../../../../components/services/ServiceForm'

export default function CreateCatalogServicePage() {
  const t = useT()
  const initialValuesRef = React.useRef<ServiceFormValues | null>(null)
  if (!initialValuesRef.current) {
    initialValuesRef.current = createServiceInitialValues()
  }

  return (
    <Page>
      <PageBody>
        <ServiceForm
          title={t('catalog.services.form.createTitle', 'Create service')}
          submitLabel={t('catalog.services.form.action.create', 'Create')}
          initialValues={initialValuesRef.current}
          successRedirect={`/backend/catalog/services?flash=${encodeURIComponent(t('catalog.services.flash.created', 'Service created'))}&type=success`}
          onSubmit={async (values: ServiceFormValues) => {
            const payload = buildServicePayload(values, t)
            const { result } = await createCrud<{ id?: string }>('catalog/services', payload)
            if (!result?.id) {
              throw createCrudFormError(t('catalog.services.form.errors.create', 'Service was created but no identifier was returned.'))
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
