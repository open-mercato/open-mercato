"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildResourceTypePayload, ResourceTypeCrudForm, type ResourceTypeFormValues } from '@open-mercato/core/modules/booking/components/ResourceTypeCrudForm'
import { useT } from '@/lib/i18n/context'

export default function BookingResourceTypeCreatePage() {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: ResourceTypeFormValues) => {
    const payload = buildResourceTypePayload(values)
    await createCrud('booking/resource-types', payload, {
      errorMessage: t('booking.resourceTypes.errors.save', 'Failed to save resource type.'),
    })
    flash(t('booking.resourceTypes.messages.saved', 'Resource type saved.'), 'success')
    router.push('/backend/booking/resource-types')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <ResourceTypeCrudForm
          mode="create"
          initialValues={{ name: '', description: '', appearance: { icon: null, color: null } }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
