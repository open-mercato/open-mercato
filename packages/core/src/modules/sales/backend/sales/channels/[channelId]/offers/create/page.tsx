"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ChannelOfferForm } from '@open-mercato/core/modules/sales/components/channels/ChannelOfferForm'

export default function CreateChannelOfferPage({ params }: { params?: { channelId?: string } }) {
  const channelId = params?.channelId ?? ''
  return (
    <Page>
      <PageBody>
        <ChannelOfferForm mode="create" channelId={channelId} />
      </PageBody>
    </Page>
  )
}
