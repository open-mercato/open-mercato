'use client'

import * as React from 'react'
import { Calendar, Check, ExternalLink, ListTodo, Mail, MoreHorizontal, Phone, StickyNote, Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { InteractionSummary } from './types'
import { isOpenInteractionStatus } from '../../lib/interactionStatus'
import { ActivityAiActions } from './ActivityAiActions'
import { EmailCardActions, type EmailCardWidgetData } from './EmailCardActions'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type ActivityCardProps = {
  activity: InteractionSummary
  onOpen?: (activity: InteractionSummary) => void
  /** Called after a successful mark-done so the parent can refresh the timeline. */
  onChanged?: () => void
  /**
   * Optional guarded-mutation runner. When provided, mutations route through the parent's
   * `useGuardedMutation` so retry-last-mutation and the global injection contract apply.
   * When omitted, mutations run directly via `apiCallOrThrow` (e.g. read-only contexts
   * or jest unit tests that don't supply a guarded runner).
   */
  runMutation?: GuardedMutationRunner
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  task: ListTodo,
}

function formatDayLabel(value: string, t: ReturnType<typeof useT>): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((today - day) / 86400000)
  if (diffDays === 0) return t('customers.timeline.date.today', 'today')
  if (diffDays === 1) return t('customers.timeline.date.yesterday', 'yesterday')
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function formatTimeLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function trimSnippet(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  if (normalized.length <= 200) return normalized
  return `${normalized.slice(0, 197)}...`
}

function resolveTarget(activity: InteractionSummary): string | null {
  const participant = activity.participants?.find((item) => item.name || item.email)
  if (participant?.name) return participant.name
  if (participant?.email) return participant.email
  if (activity.customer?.displayName) return activity.customer.displayName
  return null
}

/**
 * Build the `EmailCardWidgetData` for the email-card-actions injection spot.
 * Email metadata (rfcMessageId, addresses, threading headers, current visibility,
 * and the author flag) is populated server-side by `interactionEmailCardEnricher`
 * and surfaced via the `_integrations.email` passthrough; missing values fall
 * back to null.
 */
function buildEmailCardWidgetData(activity: InteractionSummary): EmailCardWidgetData {
  const integrations = activity._integrations as Record<string, unknown> | undefined
  const emailMeta = (integrations?.email ?? {}) as Record<string, unknown>
  return {
    interactionId: activity.id,
    // The MessageChannelLink UUID stored on the interaction row.
    externalMessageId:
      typeof emailMeta.externalMessageId === 'string' ? emailMeta.externalMessageId : null,
    // RFC2822 Message-ID (e.g. "<abc@mail.gmail.com>") for In-Reply-To / References headers.
    rfcMessageId:
      typeof emailMeta.rfcMessageId === 'string' ? emailMeta.rfcMessageId : null,
    // entityId is the CustomerEntity id — on a person detail page this IS the personId.
    personId: activity.entityId ?? null,
    fromAddress:
      typeof emailMeta.fromAddress === 'string' ? emailMeta.fromAddress : null,
    toAddresses: Array.isArray(emailMeta.toAddresses) ? (emailMeta.toAddresses as string[]) : null,
    ccAddresses: Array.isArray(emailMeta.ccAddresses) ? (emailMeta.ccAddresses as string[]) : null,
    subject: activity.title ?? null,
    inReplyTo:
      typeof emailMeta.inReplyTo === 'string' ? emailMeta.inReplyTo : null,
    references: Array.isArray(emailMeta.references) ? (emailMeta.references as string[]) : null,
    currentVisibility:
      emailMeta.currentVisibility === 'private' || emailMeta.currentVisibility === 'shared'
        ? emailMeta.currentVisibility
        : null,
    isAuthor: typeof emailMeta.isAuthor === 'boolean' ? emailMeta.isAuthor : null,
  }
}

export function ActivityCard({ activity, onOpen, onChanged, runMutation }: ActivityCardProps) {
  const t = useT()
  const timestamp = activity.occurredAt ?? activity.scheduledAt ?? activity.createdAt
  const TypeIcon = TYPE_ICONS[activity.interactionType] ?? StickyNote
  const titleBase = activity.title ?? activity.body ?? activity.interactionType
  const title = activity.duration ? `${titleBase} (${activity.duration} min)` : titleBase
  const snippet = trimSnippet(activity.body && activity.title ? activity.body : activity.body ?? null)
  const actorLabel = activity.authorName ?? activity.authorEmail ?? t('customers.changelog.user.system', 'System')
  const target = resolveTarget(activity)
  const direction = activity.interactionType === 'email'
    ? t('customers.activityLog.direction.to', 'to')
    : activity.interactionType === 'call' || activity.interactionType === 'meeting'
      ? t('customers.activityLog.direction.with', 'with')
      : ''
  const showExternalLink = Boolean(activity._integrations && Object.keys(activity._integrations).length > 0)
  const [markingDone, setMarkingDone] = React.useState(false)

  const handleMarkDone = React.useCallback(async () => {
    if (markingDone) return
    setMarkingDone(true)
    try {
      const operation = () =>
        apiCallOrThrow('/api/customers/interactions/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: activity.id, occurredAt: new Date().toISOString() }),
        })
      if (runMutation) {
        await runMutation(operation, {
          id: activity.id,
          status: 'done',
          operation: 'completeActivity',
        })
      } else {
        await operation()
      }
      flash(t('customers.activities.actions.markDoneSuccess', 'Activity marked done'), 'success')
      onChanged?.()
    } catch (err) {
      logger.warn('Mark done failed', { component: 'ActivityCard', activityId: activity.id, err })
      flash(t('customers.activities.actions.markDoneError', 'Could not mark activity as done'), 'error')
    } finally {
      setMarkingDone(false)
    }
  }, [activity.id, markingDone, onChanged, runMutation, t])

  return (
    <div
      className={cn(
        'grid gap-3',
        onOpen ? 'cursor-pointer' : '',
      )}
      style={{ gridTemplateColumns: '64px 36px minmax(0,1fr)' }}
      onClick={() => onOpen?.(activity)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(activity)
        }
      } : undefined}
    >
      <div className="pt-1 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground">{formatDayLabel(timestamp, t)}</div>
        <div>{formatTimeLabel(timestamp)}</div>
      </div>

      <div className="flex size-9 items-center justify-center rounded-lg bg-muted/80">
        <TypeIcon className="size-4 text-muted-foreground" />
      </div>

      <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-sm font-semibold text-foreground">{title}</h4>
              {showExternalLink ? <ExternalLink className="size-3.5 text-muted-foreground" /> : null}
            </div>
            {activity.location ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="size-3.5" />
                <span className="truncate">{activity.location}</span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {isOpenInteractionStatus(activity.status) ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={markingDone}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleMarkDone()
                }}
              >
                <Check className="size-3.5" />
                {t('customers.activities.actions.markDone', 'Mark done')}
              </Button>
            ) : null}
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('customers.timeline.more', 'More')}
              onClick={(event) => {
                event.stopPropagation()
                onOpen?.(activity)
              }}
            >
              <MoreHorizontal className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="mt-2">
          <ActivityAiActions activityType={activity.interactionType} />
        </div>

        {activity.interactionType === 'email' ? (
          <div
            className="mt-1"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            role="presentation"
          >
            <EmailCardActions data={buildEmailCardWidgetData(activity)} />
          </div>
        ) : null}

        {snippet ? (
          <p className="mt-2 text-sm text-muted-foreground">{snippet}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar label={actorLabel} size="xs" variant="monochrome" />
          <span className="font-medium text-foreground">{actorLabel}</span>
          {target && direction ? (
            <>
              <span>·</span>
              <span>{direction}</span>
              <span className="text-foreground">{target}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default ActivityCard
