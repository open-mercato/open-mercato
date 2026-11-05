"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildResourceTypePayload, ResourceTypeCrudForm, type ResourceTypeFormValues } from '@open-mercato/core/modules/resources/components/ResourceTypeCrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ResourcesResourceTypeCreatePage() {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: ResourceTypeFormValues) => {
    const payload = buildResourceTypePayload(values)
    await createCrud('resources/resource-types', payload, {
      errorMessage: t('resources.resourceTypes.errors.save', 'Failed to save resource type.'),
    })
    flash(t('resources.resourceTypes.messages.saved', 'Resource type saved.'), 'success')
    router.push('/backend/resources/resource-types')
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
