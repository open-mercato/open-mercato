'use client'

import * as React from 'react'
import { SquarePen, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { usePersistedBooleanFlag } from '@open-mercato/ui/backend/crud/usePersistedBooleanFlag'
import { ActivityTypeSelector, type ActivityType } from './ActivityTypeSelector'
import { MiniWeekCalendar } from './MiniWeekCalendar'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('customers')

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

const composerSchema = z.object({
  description: z.string().trim().min(1, 'customers.activityComposer.validation.descriptionRequired'),
})

interface InlineActivityComposerProps {
  entityType: 'company' | 'person' | 'deal'
  entityId: string
  dealId?: string | null
  onActivityCreated?: () => void
  runGuardedMutation?: GuardedMutationRunner
  useCanonicalInteractions?: boolean
  /** Host refresh signal forwarded to the week preview so it follows activities created, changed or deleted outside the composer. */
  refreshKey?: number
}

export function InlineActivityComposer({
  entityType,
  entityId,
  dealId = null,
  onActivityCreated,
  runGuardedMutation,
  useCanonicalInteractions,
  refreshKey,
}: InlineActivityComposerProps) {
  const t = useT()
  const calendarRefreshRef = React.useRef<(() => void) | null>(null)
  const [selectedType, setSelectedType] = React.useState<ActivityType | null>('call')
  const [description, setDescription] = React.useState('')
  const [activityDateTime, setActivityDateTime] = React.useState<Date | null>(null)
  const [datePickerOpen, setDatePickerOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const weekPreviewStorageKey = `om:inline-composer:week-preview:${entityType}`
  const { value: weekPreviewHidden, toggle: toggleWeekPreview } = usePersistedBooleanFlag(
    weekPreviewStorageKey,
    false,
  )

  const handleTypeSelect = React.useCallback((type: ActivityType) => {
    setSelectedType((previous) => (previous === type ? null : type))
    setErrors({})
  }, [])

  const handleReset = React.useCallback(() => {
    setDescription('')
    setActivityDateTime(null)
    setErrors({})
  }, [])

  const handleSave = React.useCallback(async () => {
    if (saving) return
    if (!selectedType) {
      setErrors({ type: t('customers.activityComposer.validation.typeRequired', 'Select an activity type') })
      return
    }

    const result = composerSchema.safeParse({ description })
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
      const now = new Date()
      const activityTime = activityDateTime ?? now
      const isPlanned = activityTime > now
      const timestamp = activityTime.toISOString()
      const mutationPayload = {
        entityId,
        dealId,
        interactionType: selectedType,
        body: result.data.description,
        status: isPlanned ? 'planned' : 'done',
        occurredAt: isPlanned ? null : timestamp,
        scheduledAt: isPlanned ? timestamp : null,
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
      logger.error('customers.inlineActivityComposer.save failed', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'customers', code: 'customers.activity_composer_save_failed' })
      flash(t('customers.activityComposer.error', 'Failed to save activity'), 'error')
    } finally {
      setSaving(false)
    }
  }, [
    activityDateTime,
    description,
    dealId,
    entityId,
    handleReset,
    onActivityCreated,
    runGuardedMutation,
    saving,
    selectedType,
    t,
  ])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (!datePickerOpen && !event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleSave()
    }
  }, [datePickerOpen, handleSave])

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5" onKeyDown={handleKeyDown}>
      {/* Header: title + save button */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <SquarePen className="size-4" />
          {t('customers.activityComposer.title', 'Add activity')}
        </h3>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving || !selectedType}>
          <Check className="size-4" />
          {saving
            ? t('customers.activityComposer.saving', 'Saving...')
            : t('customers.activityComposer.saveActivity', 'Save activity')}
        </Button>
      </div>

      <ActivityTypeSelector selectedType={selectedType} onSelect={handleTypeSelect} />

      <div className="mt-4 grid items-start gap-3 sm:grid-cols-3">
        <FormField
          id="inline-activity-composer-description"
          label={t('customers.activityComposer.descriptionLabel', 'Description')}
          error={errors.description}
          className="min-w-0 sm:col-span-2"
        >
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('customers.activityComposer.descriptionPlaceholder', 'Add activity details')}
            rows={3}
            autoResize
            maxRows={9}
            className="min-h-18"
          />
        </FormField>
        <FormField
          label={t('customers.activityComposer.dateTime', 'Date and time')}
          description={t('customers.activityComposer.dateTimeHint', 'Past activities go to history. Future activities are planned.')}
          className="min-w-0"
        >
          <DatePicker
            withTime
            value={activityDateTime}
            onChange={setActivityDateTime}
            open={datePickerOpen}
            onOpenChange={setDatePickerOpen}
            placeholder={t('customers.activityComposer.now', 'Now')}
            disabled={saving}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('customers.activityComposer.weekPreviewTitle', 'This week')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleWeekPreview}
            aria-expanded={!weekPreviewHidden}
            aria-controls="inline-activity-composer-week-preview"
            className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {weekPreviewHidden ? (
              <>
                <ChevronDown className="mr-1 size-3" />
                {t('customers.activityComposer.showWeekPreview', 'Show week preview')}
              </>
            ) : (
              <>
                <ChevronUp className="mr-1 size-3" />
                {t('customers.activityComposer.hideWeekPreview', 'Hide week preview')}
              </>
            )}
          </Button>
        </div>
        {!weekPreviewHidden ? (
          <div id="inline-activity-composer-week-preview">
            <MiniWeekCalendar
              entityId={entityId}
              useCanonicalInteractions={useCanonicalInteractions}
              refreshRef={calendarRefreshRef}
              refreshKey={refreshKey}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
