"use client"

import * as React from 'react'
import { UserPlus, X } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { UserSelect } from '../components/UserSelect'
import { useUserLabels } from '../components/useUserLabels'

type ParticipantKind = 'responder' | 'subscriber'

type ParticipantItem = {
  id: string
  incidentId: string
  userId: string
  kind: string
  roleId: string | null
  createdAt: string
  updatedAt: string
}

type ParticipantsResponse = {
  items?: ParticipantItem[]
  error?: string
}

type ParticipantMutationResponse = {
  ok?: boolean
  participantId?: string | null
  incidentId?: string | null
  updatedAt?: string | null
}

type ParticipantsMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type ParticipantsPanelProps = {
  incidentId: string
  updatedAt?: string | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

function isParticipantKind(value: string): value is ParticipantKind {
  return value === 'responder' || value === 'subscriber'
}

function kindLabel(t: ReturnType<typeof useT>, kind: string): string {
  if (kind === 'responder') return t('incidents.incident.detail.participants.kind.responder')
  if (kind === 'subscriber') return t('incidents.incident.detail.participants.kind.subscriber')
  return kind || t('incidents.incident.detail.participants.kind.unknown')
}

function kindVariant(kind: string): StatusBadgeVariant {
  if (kind === 'responder') return 'info'
  if (kind === 'subscriber') return 'neutral'
  return 'neutral'
}

function errorMessage(result: ParticipantsResponse | null, fallback: string): string {
  return typeof result?.error === 'string' && result.error.trim().length > 0 ? result.error : fallback
}

export function ParticipantsPanel({ incidentId, updatedAt, canManage, onChanged }: ParticipantsPanelProps) {
  const t = useT()
  const [items, setItems] = React.useState<ParticipantItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const [userId, setUserId] = React.useState('')
  const [kind, setKind] = React.useState<ParticipantKind>('responder')
  const [roleId, setRoleId] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const contextId = React.useMemo(() => `incident-participants:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<ParticipantsMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<ParticipantsMutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])
  const participantUserIds = React.useMemo(() => items.map((item) => item.userId), [items])
  const userLabels = useUserLabels(participantUserIds)

  React.useEffect(() => {
    setCurrentUpdatedAt(updatedAt ?? null)
  }, [updatedAt])

  const loadItems = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const result = await apiCall<ParticipantsResponse>(
      `/api/incidents/${encodeURIComponent(incidentId)}/participants`,
    )
    if (!result.ok) {
      throw new Error(errorMessage(result.result, t('incidents.incident.detail.participants.error.load')))
    }
    setItems(Array.isArray(result.result?.items) ? result.result.items : [])
    setIsLoading(false)
  }, [incidentId, t])

  React.useEffect(() => {
    let active = true
    loadItems().catch((err) => {
      if (!active) return
      setError(err instanceof Error ? err.message : t('incidents.incident.detail.participants.error.load'))
      setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadItems, t])

  const handleMutationSuccess = React.useCallback(async (
    response: ParticipantMutationResponse | null | undefined,
    successMessage: string,
  ) => {
    const freshUpdatedAt = response?.updatedAt
    if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
      setCurrentUpdatedAt(freshUpdatedAt)
    }
    flash(successMessage, 'success')
    await loadItems()
    void onChanged()
  }, [loadItems, onChanged])

  const handleAdd = React.useCallback(async () => {
    const trimmedUserId = userId.trim()
    if (!trimmedUserId || pending || !canManage) return
    setPending(true)
    const trimmedRoleId = roleId.trim()
    const payload: { userId: string; kind: ParticipantKind; roleId?: string | null } = {
      userId: trimmedUserId,
      kind,
    }
    if (trimmedRoleId) payload.roleId = trimmedRoleId
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ParticipantMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/participants`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('incidents.incident.detail.participants.error.add') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, ...payload },
      })
      setUserId('')
      setRoleId('')
      await handleMutationSuccess(call.result, t('incidents.incident.detail.participants.success.add'))
    } catch (err) {
      if (!surfaceRecordConflict(err, t, { onRefresh: () => {
        void loadItems()
        void onChanged()
      } })) {
        flash(t('incidents.incident.detail.participants.error.add'), 'error')
      }
    } finally {
      setPending(false)
    }
  }, [
    canManage,
    currentUpdatedAt,
    handleMutationSuccess,
    incidentId,
    kind,
    loadItems,
    mutationContext,
    onChanged,
    pending,
    roleId,
    runMutation,
    t,
    userId,
  ])

  const handleRemove = React.useCallback(async (participant: ParticipantItem) => {
    if (pending || !canManage) return
    setPending(true)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ParticipantMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/participants/${encodeURIComponent(participant.id)}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: '{}',
          },
          { errorMessage: t('incidents.incident.detail.participants.error.remove') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, participantId: participant.id },
      })
      await handleMutationSuccess(call.result, t('incidents.incident.detail.participants.success.remove'))
    } catch (err) {
      if (!surfaceRecordConflict(err, t, { onRefresh: () => {
        void loadItems()
        void onChanged()
      } })) {
        flash(t('incidents.incident.detail.participants.error.remove'), 'error')
      }
    } finally {
      setPending(false)
    }
  }, [
    canManage,
    currentUpdatedAt,
    handleMutationSuccess,
    incidentId,
    loadItems,
    mutationContext,
    onChanged,
    pending,
    runMutation,
    t,
  ])

  const handleKindChange = React.useCallback((value: string) => {
    if (isParticipantKind(value)) setKind(value)
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Spinner size="sm" />
        <span>{t('incidents.incident.detail.participants.loading')}</span>
      </div>
    )
  }

  if (error) {
    return <ErrorMessage label={error} />
  }

  return (
    <div className="space-y-4">
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((participant) => {
            const participantLabel = userLabels[participant.userId] ?? participant.userId
            return (
              <li key={participant.id} className="flex items-center gap-3 rounded-md border border-border bg-background p-2">
                <Avatar
                  label={participantLabel}
                  size="sm"
                  variant="monochrome"
                  ariaLabel={t('incidents.incident.detail.participants.avatarLabel', { id: participantLabel })}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{participantLabel}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge variant={kindVariant(participant.kind)} dot>
                      {kindLabel(t, participant.kind)}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {participant.roleId ?? t('incidents.incident.detail.participants.noRole')}
                    </span>
                  </div>
                </div>
                {canManage ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('incidents.incident.detail.participants.removeAriaLabel', { id: participantLabel })}
                    disabled={pending}
                    onClick={() => void handleRemove(participant)}
                  >
                    <X aria-hidden="true" />
                  </IconButton>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          variant="subtle"
          title={t('incidents.incident.detail.participants.empty.title')}
          description={t('incidents.incident.detail.participants.empty.description')}
        />
      )}

      {canManage ? (
        <div className="rounded-md border border-border bg-background p-3">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <UserPlus aria-hidden="true" />
              <span>{t('incidents.incident.detail.participants.addTitle')}</span>
            </div>
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label htmlFor="incident-participant-user">
                  {t('incidents.userSelect.label', 'User')}
                </Label>
                <UserSelect
                  id="incident-participant-user"
                  value={userId}
                  onChange={(next) => setUserId(next ?? '')}
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-participant-kind">
                  {t('incidents.incident.detail.participants.fields.kind')}
                </Label>
                <Select value={kind} onValueChange={handleKindChange} disabled={pending}>
                  <SelectTrigger id="incident-participant-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="responder">
                      {t('incidents.incident.detail.participants.kind.responder')}
                    </SelectItem>
                    <SelectItem value="subscriber">
                      {t('incidents.incident.detail.participants.kind.subscriber')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-participant-role">
                  {t('incidents.incident.detail.participants.fields.roleId')}
                </Label>
                <Input
                  id="incident-participant-role"
                  value={roleId}
                  onChange={(event) => setRoleId(event.currentTarget.value)}
                  placeholder={t('incidents.incident.detail.participants.placeholders.roleId')}
                  disabled={pending}
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleAdd()}
              disabled={pending || userId.trim().length === 0}
            >
              <UserPlus aria-hidden="true" />
              {pending
                ? t('incidents.incident.detail.participants.adding')
                : t('incidents.incident.detail.participants.add')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
