"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RESOURCES_RESOURCE_FIELDSET_DEFAULT } from '@open-mercato/core/modules/resources/lib/resourceCustomFields'
import { ResourcesResourceForm, useResourcesResourceFormConfig } from '@open-mercato/core/modules/resources/components/ResourceCrudForm'

export default function ResourcesResourceCreatePage() {
  const t = useT()
  const router = useRouter()
  const formConfig = useResourcesResourceFormConfig()

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const appearance = values.appearance && typeof values.appearance === 'object'
      ? values.appearance as { icon?: string | null; color?: string | null }
      : {}
    const { appearance: _appearance, ...rest } = values
    const customFieldsetCode = typeof values.customFieldsetCode === 'string' && values.customFieldsetCode.trim().length
      ? values.customFieldsetCode.trim()
      : RESOURCES_RESOURCE_FIELDSET_DEFAULT
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
      throw createCrudFormError(t('resources.resources.form.errors.nameRequired', 'Name is required.'))
    }
    const { result } = await createCrud<{ id?: string }>('resources/resources', payload, {
      errorMessage: t('resources.resources.form.errors.create', 'Failed to create resource.'),
    })
    const resourceId = typeof result?.id === 'string' ? result.id : null
    if (resourceId) {
      router.push(`/backend/resources/resources/${encodeURIComponent(resourceId)}?tab=availability&created=1`)
      return
    }
    router.push('/backend/resources/resources')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <ResourcesResourceForm
          title={t('resources.resources.form.createTitle', 'Create resource')}
          backHref="/backend/resources/resources"
          cancelHref="/backend/resources/resources"
          submitLabel={t('resources.resources.form.actions.create', 'Create')}
          formConfig={formConfig}
          initialValues={{
            description: '',
            isActive: true,
            capacityUnitValue: '',
            appearance: { icon: null, color: null },
            customFieldsetCode: RESOURCES_RESOURCE_FIELDSET_DEFAULT,
          }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
