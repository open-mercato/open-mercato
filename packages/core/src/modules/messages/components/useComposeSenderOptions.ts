"use client"

import * as React from 'react'
import type { MessageSenderOption } from '@open-mercato/ui/backend/messages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { toComposeSenderOptions } from '@open-mercato/core/modules/messages/lib/composeSenderOptions'

// `communication_channels` is optional, so its endpoint may be absent or
// forbidden here. Either way the list stays empty and the composer renders
// without a selector: platform sender only.
export function useComposeSenderOptions(enabled = true): MessageSenderOption[] {
  const [senderOptions, setSenderOptions] = React.useState<MessageSenderOption[]>([])

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const response = await apiCall<{ items?: unknown[] }>(
          '/api/communication_channels/me/channels',
          { method: 'GET', headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
        )
        if (cancelled || !response.ok) return
        setSenderOptions(toComposeSenderOptions(response.result?.items))
      } catch {
        if (!cancelled) setSenderOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return senderOptions
}
