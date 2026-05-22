'use client'

import * as React from 'react'
import { UserPlus, X, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface Participant {
  userId: string
  role: string
  lastReadAt: string | null
  addedAt: string
}

interface Props {
  open: boolean
  onOpenChange: (next: boolean) => void
  conversationId: string
}

export function ConversationShareDialog({ open, onOpenChange, conversationId }: Props) {
  const t = useT()
  const [participants, setParticipants] = React.useState<Participant[]>([])
  const [loading, setLoading] = React.useState(false)
  const [addUserId, setAddUserId] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const baseUrl = `/api/ai/conversations/${conversationId}/participants`

  const fetchParticipants = React.useCallback(async () => {
    if (!conversationId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall<{ participants: Participant[] }>(baseUrl)
      setParticipants(
        res.participants.filter((p) => p.role !== 'owner'),
      )
    } catch {
      setError(t('common.error', 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }, [conversationId, baseUrl, t])

  React.useEffect(() => {
    if (open) {
      setAddUserId('')
      setError(null)
      fetchParticipants()
    }
  }, [open, fetchParticipants])

  const handleAdd = async () => {
    const uid = addUserId.trim()
    if (!uid) return
    setAdding(true)
    setError(null)
    try {
      const res = await apiCall<{ participant: Participant }>(baseUrl, {
        method: 'POST',
        body: JSON.stringify({ userId: uid, role: 'viewer' }),
      })
      setParticipants((prev) => {
        const exists = prev.find((p) => p.userId === res.participant.userId)
        if (exists) return prev.map((p) => (p.userId === res.participant.userId ? res.participant : p))
        return [...prev, res.participant]
      })
      setAddUserId('')
    } catch {
      setError(t('common.error', 'Something went wrong.'))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: string) => {
    setRemovingId(userId)
    setError(null)
    try {
      await apiCall(`${baseUrl}/${userId}`, { method: 'DELETE' })
      setParticipants((prev) => prev.filter((p) => p.userId !== userId))
    } catch {
      setError(t('common.error', 'Something went wrong.'))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('ai_assistant.share.dialogTitle', 'Share Conversation')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'ai_assistant.share.dialogDescription',
              'Share this conversation with other users. They will get read-only access.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={t('ai_assistant.share.participantPlaceholder', 'User ID...')}
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!addUserId.trim() || adding}
              size="sm"
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              {t('ai_assistant.share.addParticipant', 'Add')}
            </Button>
          </div>

          {error ? (
            <p className="text-sm text-status-danger-text">{error}</p>
          ) : null}

          <div className="space-y-2 min-h-[60px]">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : participants.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                {t(
                  'ai_assistant.share.noParticipants',
                  'No participants yet. Add someone to share this conversation.',
                )}
              </p>
            ) : (
              participants.map((p) => (
                <div
                  key={p.userId}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-mono text-foreground">{p.userId}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.role}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => handleRemove(p.userId)}
                    disabled={removingId === p.userId}
                    aria-label={t('ai_assistant.share.removeParticipant', 'Remove')}
                  >
                    {removingId === p.userId ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <X className="size-3" />
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConversationShareDialog
