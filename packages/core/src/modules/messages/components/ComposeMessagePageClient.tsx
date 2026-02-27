"use client"

import { useRouter } from 'next/navigation'
import { MessageComposer } from '@open-mercato/ui/backend/messages'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function ComposeMessagePageClient({ canViewMessages = true }: { canViewMessages?: boolean }) {
  const router = useRouter()
  const t = useT()

  if (!canViewMessages) {
    return (
      <ErrorMessage
        label={t('messages.access.disabled.title', 'Messages module is disabled for your role.')}
        description={t(
          'messages.access.disabled.description',
          'Ask your administrator to enable the required Messages permissions.',
        )}
      />
    )
  }

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
