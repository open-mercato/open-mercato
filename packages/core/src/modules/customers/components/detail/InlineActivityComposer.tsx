'use client'

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { ActivityTypeSelector, type ActivityType } from './ActivityTypeSelector'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

const composerSchema = z.object({
  description: z.string().trim().min(1, 'customers.activityComposer.validation.descriptionRequired'),
  occurredAt: z.string().min(1),
})

interface InlineActivityComposerProps {
  entityType: 'company' | 'person' | 'deal'
  entityId: string
  onActivityCreated?: () => void
  runGuardedMutation?: GuardedMutationRunner
}

export function InlineActivityComposer({
  entityType,
  entityId,
  onActivityCreated,
  runGuardedMutation,
}: InlineActivityComposerProps) {
  const t = useT()
  const [selectedType, setSelectedType] = React.useState<ActivityType | null>(null)
  const [description, setDescription] = React.useState('')
  const [occurredAt, setOccurredAt] = React.useState(() => new Date().toISOString().slice(0, 16))
  const [scheduledAt, setScheduledAt] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null)

  const handleTypeSelect = React.useCallback((type: ActivityType) => {
    setSelectedType((previous) => (previous === type ? null : type))
    setErrors({})
    requestAnimationFrame(() => {
      descriptionRef.current?.focus()
    })
  }, [])

  const handleCancel = React.useCallback(() => {
    setSelectedType(null)
    setDescription('')
    setOccurredAt(new Date().toISOString().slice(0, 16))
    setScheduledAt('')
    setErrors({})
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!selectedType) return

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
      handleCancel()
      onActivityCreated?.()
    } catch (error) {
      console.error('customers.inlineActivityComposer.save failed', error)
      flash(t('customers.activityComposer.error'), 'error')
    } finally {
      setSaving(false)
    }
  }, [
    description,
    entityId,
    handleCancel,
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
    if (event.key === 'Escape' && !description.trim()) {
      event.preventDefault()
      handleCancel()
    }
  }, [description, handleCancel, handleSave])

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <ActivityTypeSelector selectedType={selectedType} onSelect={handleTypeSelect} />
        {selectedType ? (
          <span className="text-xs text-muted-foreground">
            {t('customers.activityComposer.hint')}
          </span>
        ) : null}
      </div>

      {selectedType ? (
        <div className="mt-3 space-y-3" onKeyDown={handleKeyDown}>
          <div>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('customers.activityComposer.descriptionPlaceholder')}
              className="min-h-[60px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              rows={2}
            />
            {errors.description ? (
              <p className="mt-1 text-xs text-destructive">{errors.description}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                {t('customers.activityComposer.dateLabel')}
              </label>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                {t('customers.activityComposer.scheduledLabel')}
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={saving}
              >
                {t('customers.activityComposer.cancel')}
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? t('customers.activityComposer.saving')
                  : t('customers.activityComposer.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
