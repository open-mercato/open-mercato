'use client'

import * as React from 'react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ChannelEnrichment = {
  providerKey?: string
  channelType?: string
  direction?: 'inbound' | 'outbound' | string
  deliveryStatus?: string | null
}

export type ChannelBadgeProps = {
  channel: ChannelEnrichment | null | undefined
}

/**
 * Pure presentational badge — renders the channel provider/type as a `<Tag>`
 * pill. The host (declarative column injection — see `widget.ts`) feeds the
 * `_channel` enrichment in.
 */
export default function ChannelBadgeWidget({ channel }: ChannelBadgeProps) {
  const t = useT()
  if (!channel) return null

  const providerLabel = channel.providerKey ?? channel.channelType ?? ''
  const variant: 'success' | 'info' = channel.direction === 'outbound' ? 'info' : 'success'

  return (
    <Tag variant={variant} dot>
      {t(
        `communication_channels.channel.providers.${providerLabel}`,
        providerLabel,
      )}
    </Tag>
  )
}
