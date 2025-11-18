"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ChannelOfferForm } from '@open-mercato/core/modules/sales/components/channels/ChannelOfferForm'

export default function EditChannelOfferPage() {
  const params = useParams<{ channelId: string; offerId: string }>()
  const channelId = params?.channelId ?? ''
  const offerId = params?.offerId ?? ''
  return (
    <Page>
      <PageBody>
        <ChannelOfferForm mode="edit" channelId={channelId} offerId={offerId} />
      </PageBody>
    </Page>
  )
}
