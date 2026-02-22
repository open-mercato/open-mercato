"use client"

import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MessageComposer } from '@open-mercato/ui/backend/messages'

export function ComposeMessagePageClient() {
  const router = useRouter()

  return (
    <div className="space-y-4">
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
