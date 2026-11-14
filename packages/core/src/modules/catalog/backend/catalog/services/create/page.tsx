"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '#generated/entities.ids.generated'
import { transferDraftMedia } from '../../../../components/products/mediaTransfer'
import {
  buildServicePayload,
  createServiceInitialValues,
  ServiceForm,
  type ServiceFormValues,
} from '../../../../components/services/ServiceForm'

const logger = createLogger('catalog')

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
            const mediaTransfer = await transferDraftMedia({
              entityId: E.catalog.catalog_service,
              draftId: values.mediaDraftId,
              recordId: result.id,
              mediaItems: Array.isArray(values.mediaItems) ? values.mediaItems : [],
            })
            if (mediaTransfer.failedCount > 0) {
              logger.error('attachments.transfer.failed', {
                failed: mediaTransfer.failedCount,
                requested: mediaTransfer.requestedCount,
                errors: mediaTransfer.errors,
              })
              flash(
                t(
                  'catalog.services.create.mediaTransferIncomplete',
                  'Service created, but {failed} of {total} media files could not be attached.',
                  { failed: mediaTransfer.failedCount, total: mediaTransfer.requestedCount },
                ),
                'warning',
              )
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
