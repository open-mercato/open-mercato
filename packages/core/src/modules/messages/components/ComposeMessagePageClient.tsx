"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { extensionPoints } from '@open-mercato/core/modules/messages/extension-points'
import { MessageComposer } from '@open-mercato/ui/backend/messages'
import type { MessageSenderOption } from '@open-mercato/ui/backend/messages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { toComposeSenderOptions } from '@open-mercato/core/modules/messages/lib/composeSenderOptions'
// UMES extension surface — compose page injection spot (SPEC-045d §9.3a).
// Channel provider packages inject "composer capabilities" widgets here
// (character limit warnings, channel format selector, attachment scoping, etc.).
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'

export function ComposeMessagePageClient() {
  const router = useRouter()
  const [senderOptions, setSenderOptions] = React.useState<MessageSenderOption[]>([])

  // `communication_channels` is optional, so its endpoint may be absent or
  // forbidden here. Either way the list stays empty and the composer renders
  // exactly as before: no selector, platform sender only.
  React.useEffect(() => {
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
  }, [])

  return (
    <div className="space-y-4">
      {/*
        Standalone widget mount above the composer — NOT CrudForm field
        resolution. This page is not a CrudForm, so the `crud-form:*:fields`
        field-event pipeline (onFieldChange, value transformers, etc.) does
        not apply here. Provider packages render composer-capability widgets
        (character-limit warnings, channel format selectors, attachment
        scoping) into this spot purely as additional UI siblings.
      */}
      <InjectionSpot
        spotId={extensionPoints.hosts.composeFields.spotId}
        context={{ form: 'compose' }}
        data={{}}
      />
      <MessageComposer
        inline
        variant="compose"
        senderOptions={senderOptions}
        onCancel={() => {
          router.push('/backend/messages')
        }}
        onSuccess={() => {
          router.push('/backend/messages')
        }}
      />
    </div>
  )
}
