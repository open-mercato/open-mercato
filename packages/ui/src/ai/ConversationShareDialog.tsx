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
import { Input } from '../primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select'
import { apiCall } from '../backend/utils/apiCall'
import { useCurrentUserId } from '../backend/utils/useCurrentUserId'
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
  const currentUserId = useCurrentUserId()
  const [participants, setParticipants] = React.useState<Participant[]>([])
  const [ownerUserId, setOwnerUserId] = React.useState<string | null>(null)
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [canListUsers, setCanListUsers] = React.useState(true)
  const [loading, setLoading] = React.useState(false)
  const [loadingUsers, setLoadingUsers] = React.useState(false)
  const [selectedUserId, setSelectedUserId] = React.useState('')
  const [textUserId, setTextUserId] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const baseUrl = `/api/ai_assistant/ai/conversations/${conversationId}/participants`

  const fetchParticipants = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall<{ participants: Participant[]; ownerUserId?: string | null }>(baseUrl)
      if (!res.ok || !res.result) throw new Error('fetch failed')
      setParticipants(res.result.participants.filter((p) => p.role !== 'owner'))
      setOwnerUserId(res.result.ownerUserId ?? null)
    } catch {
      setError(t('common.error', 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }, [conversationId, t])

  const fetchUsers = React.useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await apiCall<{ items: UserOption[] }>('/api/auth/users?limit=200')
      if (res.ok && res.result) {
        setUsers(res.result.items)
        setCanListUsers(true)
      } else {
        setCanListUsers(false)
      }
    } catch {
      setCanListUsers(false)
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      setSelectedUserId('')
      setTextUserId('')
      setError(null)
      void Promise.all([fetchParticipants(), fetchUsers()])
    }
  }, [open, fetchParticipants, fetchUsers])

  const participantIds = React.useMemo(
    () => new Set(participants.map((p) => p.userId)),
    [participants],
  )

  const availableUsers = React.useMemo(
    () =>
      users.filter(
        (u) => !participantIds.has(u.id) && u.id !== currentUserId && u.id !== ownerUserId,
      ),
    [users, participantIds, currentUserId, ownerUserId],
  )

  const activeUserId = canListUsers ? selectedUserId : textUserId.trim()

  const handleAdd = React.useCallback(async () => {
    if (!activeUserId) return
    setAdding(true)
    setError(null)
    try {
      const res = await apiCall<{ participant: Participant }>(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: activeUserId, role: 'viewer' }),
      })
      if (!res.ok || !res.result) throw new Error('fetch failed')
      setParticipants((prev) => {
        const next = res.result!.participant
        const exists = prev.find((p) => p.userId === next.userId)
        if (exists) return prev.map((p) => (p.userId === next.userId ? next : p))
        return [...prev, next]
      })
      setSelectedUserId('')
      setTextUserId('')
    } catch {
      setError(t('common.error', 'Something went wrong.'))
    } finally {
      setAdding(false)
    }
  }, [activeUserId, baseUrl, t])

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (activeUserId && !adding) void handleAdd()
      }
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, activeUserId, adding, handleAdd])

  const handleRemove = async (userId: string) => {
    setRemovingId(userId)
    setError(null)
    try {
      await apiCall(`${baseUrl}/${userId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } })
      setParticipants((prev) => prev.filter((p) => p.userId !== userId))
    } catch {
      setError(t('common.error', 'Something went wrong.'))
    } finally {
      setRemovingId(null)
    }
  }

  const formatUserLabel = (u: UserOption) => (u.name ? `${u.name} — ${u.email}` : u.email)

  const getUserLabel = (userId: string) => {
    const u = users.find((u) => u.id === userId)
    return u ? formatUserLabel(u) : userId
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
            {canListUsers === false ? (
              <Input
                placeholder={t('ai_assistant.share.participantPlaceholder', 'User ID...')}
                value={textUserId}
                onChange={(e) => setTextUserId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void handleAdd() }
                }}
                className="flex-1"
              />
            ) : (
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
                      {formatUserLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              onClick={() => void handleAdd()}
              disabled={!activeUserId || adding}
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
                    onClick={() => void handleRemove(p.userId)}
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
