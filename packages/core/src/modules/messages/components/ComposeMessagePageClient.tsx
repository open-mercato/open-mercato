"use client"

import { useRouter } from 'next/navigation'
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
          router.push('/backend/messages')
        }}
      />
    </div>
  )
}
