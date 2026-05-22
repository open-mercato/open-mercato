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
} from '../primitives/dialog'
import { Button } from '../primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select'
import { apiCall } from '../backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface Participant {
  userId: string
  role: string
  lastReadAt: string | null
  addedAt: string
}

interface UserOption {
  id: string
  email: string
  name: string | null
}

interface Props {
  open: boolean
  onOpenChange: (next: boolean) => void
  conversationId: string
}

export function ConversationShareDialog({ open, onOpenChange, conversationId }: Props) {
  const t = useT()
  const [participants, setParticipants] = React.useState<Participant[]>([])
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadingUsers, setLoadingUsers] = React.useState(false)
  const [selectedUserId, setSelectedUserId] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const baseUrl = `/api/ai_assistant/ai/conversations/${conversationId}/participants`

  const fetchParticipants = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall<{ participants: Participant[] }>(baseUrl)
      if (!res.ok || !res.result) throw new Error('fetch failed')
      setParticipants(res.result.participants.filter((p) => p.role !== 'owner'))
    } catch {
      setError(t('common.error', 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }, [conversationId, baseUrl, t])

  const fetchUsers = React.useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await apiCall<{ items: UserOption[] }>('/api/auth/users?limit=200')
      if (res.ok && res.result) setUsers(res.result.items)
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      setSelectedUserId('')
      setError(null)
      fetchParticipants()
      fetchUsers()
    }
  }, [open, fetchParticipants, fetchUsers])

  const participantIds = React.useMemo(
    () => new Set(participants.map((p) => p.userId)),
    [participants],
  )

  const availableUsers = React.useMemo(
    () => users.filter((u) => !participantIds.has(u.id)),
    [users, participantIds],
  )

  const handleAdd = async () => {
    if (!selectedUserId) return
    setAdding(true)
    setError(null)
    try {
      const res = await apiCall<{ participant: Participant }>(baseUrl, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, role: 'viewer' }),
      })
      if (!res.ok || !res.result) throw new Error('fetch failed')
      setParticipants((prev) => {
        const exists = prev.find((p) => p.userId === res.result!.participant.userId)
        if (exists) return prev.map((p) => (p.userId === res.result!.participant.userId ? res.result!.participant : p))
        return [...prev, res.result!.participant]
      })
      setSelectedUserId('')
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

  const getUserLabel = (userId: string) => {
    const u = users.find((u) => u.id === userId)
    if (!u) return userId
    return u.name ? `${u.name} (${u.email})` : u.email
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
            <Select
              value={selectedUserId}
              onValueChange={setSelectedUserId}
              disabled={loadingUsers || availableUsers.length === 0}
            >
              <SelectTrigger className="flex-1">
                <SelectValue
                  placeholder={
                    loadingUsers
                      ? t('common.loading', 'Loading...')
                      : availableUsers.length === 0
                        ? t('ai_assistant.share.allUsersAdded', 'All users already added')
                        : t('ai_assistant.share.selectUser', 'Select a user...')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name ? `${u.name} — ${u.email}` : u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!selectedUserId || adding}
              size="default"
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
                    <p className="truncate text-sm text-foreground">{getUserLabel(p.userId)}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.role}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(p.userId)}
                    disabled={removingId === p.userId}
                    aria-label={t('ai_assistant.share.removeParticipant', 'Remove')}
                  >
                    {removingId === p.userId ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <X className="size-4" />
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
