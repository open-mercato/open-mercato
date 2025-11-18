"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useRouter } from 'next/navigation'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { useChannelFields, buildChannelPayload, type ChannelFormValues } from '@open-mercato/core/modules/sales/components/channels/channelFormFields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

export default function CreateChannelPage() {
  const t = useT()
  const { fields, groups } = useChannelFields()
  const router = useRouter()

  return (
    <Page>
      <PageBody>
        <CrudForm<ChannelFormValues>
          title={t('sales.channels.form.createTitle', 'Create sales channel')}
          entityId={E.sales.sales_channel}
          fields={fields}
          groups={[
            ...groups,
            { id: 'custom', kind: 'customFields' },
          ]}
          initialValues={{ isActive: true }}
          submitLabel={t('sales.channels.form.createSubmit', 'Create channel')}
          cancelHref="/backend/sales/channels"
          onSubmit={async (values) => {
            const payload = buildChannelPayload(values)
            const customFields = collectCustomFieldValues(values)
            if (Object.keys(customFields).length) {
              payload.customFields = customFields
            }
            await createCrud('sales/channels', payload, {
              errorMessage: t('sales.channels.form.errors.create', 'Failed to create channel.'),
            })
            flash(t('sales.channels.form.messages.created', 'Channel created.'), 'success')
            router.push('/backend/sales/channels')
          }}
        />
      </PageBody>
    </Page>
  )
}
