"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ChannelOfferForm } from '@open-mercato/core/modules/sales/components/channels/ChannelOfferForm'

export default function CreateChannelOfferPage() {
  const params = useParams<{ channelId: string }>()
  const channelId = params?.channelId ?? ''
  return (
    <Page>
      <PageBody>
        <ChannelOfferForm mode="create" channelId={channelId} />
      </PageBody>
    </Page>
  )
}
