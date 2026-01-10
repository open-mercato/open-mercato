"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@/lib/i18n/context'
import { BOOKING_RESOURCE_FIELDSET_DEFAULT } from '@open-mercato/core/modules/booking/lib/resourceCustomFields'
import { BookingResourceForm, useBookingResourceFormConfig } from '@open-mercato/core/modules/booking/components/ResourceCrudForm'

export default function BookingResourceCreatePage() {
  const t = useT()
  const router = useRouter()
  const formConfig = useBookingResourceFormConfig()

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const appearance = values.appearance && typeof values.appearance === 'object'
      ? values.appearance as { icon?: string | null; color?: string | null }
      : {}
    const { appearance: _appearance, ...rest } = values
    const customFieldsetCode = typeof values.customFieldsetCode === 'string' && values.customFieldsetCode.trim().length
      ? values.customFieldsetCode.trim()
      : BOOKING_RESOURCE_FIELDSET_DEFAULT
    const payload: Record<string, unknown> = {
      ...rest,
      capacity: values.capacity ? Number(values.capacity) : null,
      capacityUnitValue: values.capacityUnitValue ? String(values.capacityUnitValue) : null,
      appearanceIcon: appearance.icon ?? null,
      appearanceColor: appearance.color ?? null,
      isActive: values.isActive ?? true,
      customFieldsetCode,
      ...collectCustomFieldValues(values),
    }
    if (!payload.name || String(payload.name).trim().length === 0) {
      throw createCrudFormError(t('booking.resources.form.errors.nameRequired', 'Name is required.'))
    }
    const { result } = await createCrud<{ id?: string }>('booking/resources', payload, {
      errorMessage: t('booking.resources.form.errors.create', 'Failed to create resource.'),
    })
    const resourceId = typeof result?.id === 'string' ? result.id : null
    if (resourceId) {
      router.push(`/backend/booking/resources/${encodeURIComponent(resourceId)}?tab=availability&created=1`)
      return
    }
    router.push('/backend/booking/resources')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <BookingResourceForm
          title={t('booking.resources.form.createTitle', 'Create resource')}
          backHref="/backend/booking/resources"
          cancelHref="/backend/booking/resources"
          submitLabel={t('booking.resources.form.actions.create', 'Create')}
          formConfig={formConfig}
          initialValues={{
            description: '',
            isActive: true,
            capacityUnitValue: '',
            appearance: { icon: null, color: null },
            customFieldsetCode: BOOKING_RESOURCE_FIELDSET_DEFAULT,
          }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
