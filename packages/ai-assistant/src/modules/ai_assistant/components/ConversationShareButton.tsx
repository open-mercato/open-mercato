'use client'

import * as React from 'react'
import { Share2 } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useAiChatSessions } from '@open-mercato/ui/ai'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ConversationShareDialog } from './ConversationShareDialog'

interface Props {
  agentId: string
}

export function ConversationShareButton({ agentId }: Props) {
  const t = useT()
  const sessions = useAiChatSessions()
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const activeSession = sessions.getActiveSession(agentId)
  const conversationId = activeSession?.conversationId

  if (!conversationId) return null

  return (
    <>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setDialogOpen(true)}
        aria-label={t('ai_assistant.share.shareButton', 'Share')}
        title={t('ai_assistant.share.shareButton', 'Share')}
        data-ai-chat-share-conversation=""
      >
        <Share2 className="size-4" aria-hidden />
      </IconButton>
      <ConversationShareDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        conversationId={conversationId}
      />
    </>
  )
}

export default ConversationShareButton
