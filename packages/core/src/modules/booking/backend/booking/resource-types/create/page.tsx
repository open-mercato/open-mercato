"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'

type ResourceTypeFormValues = {
  name: string
  description?: string
} & Record<string, unknown>

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export default function BookingResourceTypeCreatePage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.resourceTypes.form.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('booking.resourceTypes.form.description', 'Description'), type: 'textarea' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: ['name', 'description'] },
    { id: 'custom', title: t('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
  ], [t])

  const handleSubmit = React.useCallback(async (values: ResourceTypeFormValues) => {
    const name = typeof values.name === 'string' ? values.name.trim() : ''
    const description = typeof values.description === 'string' && values.description.trim().length
      ? values.description.trim()
      : null
    const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
    const payload: Record<string, unknown> = {
      name,
      description,
      ...(Object.keys(customFields).length ? { customFields } : {}),
    }
    await createCrud('booking/resource-types', payload, {
      errorMessage: t('booking.resourceTypes.errors.save', 'Failed to save resource type.'),
    })
    flash(t('booking.resourceTypes.messages.saved', 'Resource type saved.'), 'success')
    router.push('/backend/booking/resource-types')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<ResourceTypeFormValues>
          title={t('booking.resourceTypes.form.createTitle', 'Add resource type')}
          backHref="/backend/booking/resource-types"
          cancelHref="/backend/booking/resource-types"
          submitLabel={t('booking.resourceTypes.form.save', 'Save')}
          fields={fields}
          groups={groups}
          entityId={E.booking.booking_resource_type}
          initialValues={{ name: '', description: '' }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
