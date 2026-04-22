'use client'

import * as React from 'react'
import { SquarePen, Calendar, Check } from 'lucide-react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { ActivityTypeSelector, type ActivityType } from './ActivityTypeSelector'
import { MiniWeekCalendar } from './MiniWeekCalendar'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

const composerSchema = z.object({
  description: z.string().trim().min(1, 'customers.activityComposer.validation.descriptionRequired'),
  occurredAt: z.string().min(1),
})

type TranslateFn = (key: string, fallback?: string, params?: Record<string, string>) => string

function formatDateBadge(isoLocal: string, t: TranslateFn): string {
  if (!isoLocal) return ''
  const now = new Date()
  const date = new Date(isoLocal.replace('T', ' '))
  const time = isoLocal.slice(11, 16)
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const dayLabel = isToday
    ? t('customers.activityComposer.today', 'Today')
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${dayLabel} · ${time}`
}

interface InlineActivityComposerProps {
  entityType: 'company' | 'person' | 'deal'
  entityId: string
  dealId?: string | null
  onActivityCreated?: () => void
  runGuardedMutation?: GuardedMutationRunner
  onScheduleRequested?: () => void
  useCanonicalInteractions?: boolean
}

export function InlineActivityComposer({
  entityType,
  entityId,
  dealId = null,
  onActivityCreated,
  runGuardedMutation,
  onScheduleRequested,
  useCanonicalInteractions,
}: InlineActivityComposerProps) {
  const t = useT()
  const calendarRefreshRef = React.useRef<(() => void) | null>(null)
  const [selectedType, setSelectedType] = React.useState<ActivityType | null>('call')
  const [description, setDescription] = React.useState('')
  const [occurredAt, setOccurredAt] = React.useState(() => new Date().toISOString().slice(0, 16))
  const [scheduledAt, setScheduledAt] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null)

  const handleTypeSelect = React.useCallback((type: ActivityType) => {
    setSelectedType((previous) => (previous === type ? null : type))
    setErrors({})
  }, [])

  const handleReset = React.useCallback(() => {
    setDescription('')
    setOccurredAt(new Date().toISOString().slice(0, 16))
    setScheduledAt('')
    setErrors({})
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!selectedType) {
      setErrors({ type: t('customers.activityComposer.validation.typeRequired', 'Select an activity type') })
      return
    }

    const result = composerSchema.safeParse({ description, occurredAt })
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0]
        if (field) fieldErrors[String(field)] = t(issue.message)
      }
      setErrors(fieldErrors)
      return
    }

    setSaving(true)
    setErrors({})

    try {
      const mutationPayload = {
        entityId,
        dealId,
        interactionType: selectedType,
        body: description.trim(),
        status: scheduledAt ? 'planned' : 'done',
        occurredAt: scheduledAt ? null : new Date(occurredAt).toISOString(),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }
      const operation = () =>
        apiCallOrThrow('/api/customers/interactions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mutationPayload),
        })

      if (runGuardedMutation) {
        await runGuardedMutation(operation, mutationPayload)
      } else {
        await operation()
      }

      flash(
        t('customers.activityComposer.saved', {
          type: t(`customers.activityComposer.types.${selectedType}`),
        }),
        'success',
      )
      handleReset()
      calendarRefreshRef.current?.()
      onActivityCreated?.()
    } catch (error) {
      console.error('customers.inlineActivityComposer.save failed', error)
      flash(t('customers.activityComposer.error', 'Failed to save activity'), 'error')
    } finally {
      setSaving(false)
    }
  }, [
    description,
    dealId,
    entityId,
    handleReset,
    occurredAt,
    onActivityCreated,
    runGuardedMutation,
    scheduledAt,
    selectedType,
    t,
  ])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5" onKeyDown={handleKeyDown}>
      {/* Header: title + save button */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <SquarePen className="size-4" />
          {t('customers.activityComposer.title', 'Log activity')}
        </h3>
        <div className="flex items-center gap-2">
          {onScheduleRequested ? (
            <Button type="button" variant="outline" size="sm" onClick={onScheduleRequested} disabled={saving}>
              <Calendar className="size-4" />
              {t('customers.activityComposer.schedule', 'Schedule')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || !selectedType}
          >
            <Check className="size-4" />
            {saving
              ? t('customers.activityComposer.saving', 'Saving...')
              : t('customers.activityComposer.saveActivity', 'Save activity')}
          </Button>
        </div>
      </div>

      {/* Activity type selector — 4 equal-width buttons */}
      <ActivityTypeSelector selectedType={selectedType} onSelect={handleTypeSelect} />

      {/* Description + date row */}
      <div className="mt-4 flex items-start gap-3">
        <div className="flex-1">
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('customers.activityComposer.descriptionPlaceholder', 'What happened?')}
            className="min-h-[44px] w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows={1}
          />
          {errors.description ? (
            <p className="mt-1 text-xs text-destructive">{errors.description}</p>
          ) : null}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-sm text-muted-foreground">
          <Calendar className="size-4" />
          <span className="text-sm font-medium text-foreground">{formatDateBadge(occurredAt, t)}</span>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            className="sr-only"
          />
        </label>
      </div>

      {/* Mini calendar preview */}
      <div className="mt-4">
        <MiniWeekCalendar entityId={entityId} useCanonicalInteractions={useCanonicalInteractions} refreshRef={calendarRefreshRef} />
      </div>

      {/* Scheduled for (optional) */}
      {scheduledAt || false ? (
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-muted-foreground">
            {t('customers.activityComposer.scheduledLabel', 'Scheduled for')}
          </label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : null}
    </div>
  )
}
