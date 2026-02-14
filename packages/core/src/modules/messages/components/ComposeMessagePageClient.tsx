"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MessageComposer } from '@open-mercato/ui/backend/messages'

export function ComposeMessagePageClient() {
  const router = useRouter()
  const t = useT()

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('messages.composeHint', 'Create a message, attach objects, and send it to selected recipients.')}
      </p>

      <MessageComposer
        inline
        variant="compose"
        onCancel={() => {
          router.push('/backend/messages')
        }}
        onSuccess={(result) => {
          if (result.id) {
            router.push(`/backend/messages/${result.id}`)
            return
          }
          router.push('/backend/messages')
        }}
      />
    </div>
  )
}
