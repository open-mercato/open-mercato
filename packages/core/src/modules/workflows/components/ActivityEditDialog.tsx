'use client'

import { useEffect, useState } from 'react'
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
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { DurationInput } from '@open-mercato/ui/backend/inputs/DurationInput'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ActivityConfigFields, hasActivityConfigForm } from './fields/ActivityConfigFields'
import { useActivityTypeOptions } from './fields/useActivityTypeOptions'
import type { Activity } from './fields/ActivityArrayEditor'
import type { LedgerEntry } from '../lib/context-ledger'

export interface ActivityEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The activity to edit; `null` renders nothing (dialog closed / no target). */
  activity: Activity | null
  /** "Assess → Issue refund" — the route the activity runs on, for context. */
  routeLabel?: string
  ledgerEntries?: LedgerEntry[]
  onSave: (activity: Activity) => void
  onRemove: () => void
  /** Escape hatch to the full transition inspector for condition/rules/ordering. */
  onOpenFullTransition: () => void
}

/**
 * Edits ONE activity on a route (fidelity gap #6 follow-up). Clicking a single
 * activity chip opens this focused modal instead of the full transition
 * inspector — the author clicked that activity, so the affordance edits exactly
 * it (name, type, typed config, timeout, retry/async), with an escape hatch to
 * the full inspector for the route's condition, business rules and activity
 * ordering. Edits a working copy so Cancel reverts; Cmd/Ctrl+Enter saves.
 */
export function ActivityEditDialog({
  open,
  onOpenChange,
  activity,
  routeLabel,
  ledgerEntries,
  onSave,
  onRemove,
  onOpenFullTransition,
}: ActivityEditDialogProps) {
  const t = useT()
  const typeOptions = useActivityTypeOptions()
  const [working, setWorking] = useState<Activity | null>(activity)

  useEffect(() => {
    if (open) setWorking(activity)
  }, [open, activity])

  const handleSave = () => {
    if (working) onSave(working)
    onOpenChange(false)
  }

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave, onCancel: () => onOpenChange(false) })

  if (!working) return null

  const typeLabel = typeOptions.find((option) => option.value === working.activityType)?.label ?? working.activityType
  const retry = working.retryPolicy ?? {}
  const patchRetry = (patch: Partial<NonNullable<Activity['retryPolicy']>>) =>
    setWorking((current) => (current ? { ...current, retryPolicy: { ...current.retryPolicy, ...patch } } : current))
  const parseNumber = (value: string): number | undefined => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl max-h-[85vh] overflow-y-auto"
        onKeyDown={handleKeyDown}
        data-testid="workflow-activity-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {t('workflows.activityDialog.title', 'Edit activity')} · {typeLabel}
          </DialogTitle>
          {routeLabel ? (
            <DialogDescription>
              {t('workflows.activityDialog.onRoute', 'On route {route}', { route: routeLabel })}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activity-edit-name">{t('workflows.activityDialog.name', 'Name')}</Label>
              <Input
                id="activity-edit-name"
                value={working.activityName}
                onChange={(event) => setWorking((current) => (current ? { ...current, activityName: event.target.value } : current))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activity-edit-type">{t('workflows.activityDialog.type', 'Type')}</Label>
              <Select
                value={working.activityType}
                onValueChange={(value) => setWorking((current) => (current ? { ...current, activityType: value } : current))}
              >
                <SelectTrigger id="activity-edit-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasActivityConfigForm(working.activityType) ? (
            <ActivityConfigFields
              activityType={working.activityType}
              idPrefix="activity-edit-config"
              config={(working.config ?? {}) as Record<string, unknown>}
              onChange={(config) => setWorking((current) => (current ? { ...current, config: config as Record<string, unknown> } : current))}
              ledgerEntries={ledgerEntries}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(
                'workflows.activityDialog.noTypedConfig',
                'This activity type has no typed config form. Use "Open full transition" for advanced JSON.',
              )}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="activity-edit-timeout">{t('workflows.activityDialog.timeout', 'Timeout')}</Label>
            <DurationInput
              id="activity-edit-timeout"
              value={working.timeout ?? ''}
              onChange={(value) => setWorking((current) => (current ? { ...current, timeout: value || undefined } : current))}
            />
          </div>

          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
              {t('workflows.activityDialog.advanced', 'Advanced')}
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <Label className="mb-1.5 block">{t('workflows.activityDialog.retry', 'Retry policy')}</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Input
                    aria-label={t('workflows.activityDialog.retryAttempts', 'Max attempts')}
                    type="number"
                    placeholder="3"
                    value={retry.maxAttempts ?? ''}
                    onChange={(event) => patchRetry({ maxAttempts: parseNumber(event.target.value) })}
                  />
                  <Input
                    aria-label={t('workflows.activityDialog.retryInitial', 'Initial interval (ms)')}
                    type="number"
                    placeholder="1000"
                    value={retry.initialIntervalMs ?? ''}
                    onChange={(event) => patchRetry({ initialIntervalMs: parseNumber(event.target.value) })}
                  />
                  <Input
                    aria-label={t('workflows.activityDialog.retryBackoff', 'Backoff coefficient')}
                    type="number"
                    placeholder="2"
                    value={retry.backoffCoefficient ?? ''}
                    onChange={(event) => patchRetry({ backoffCoefficient: parseNumber(event.target.value) })}
                  />
                  <Input
                    aria-label={t('workflows.activityDialog.retryMax', 'Max interval (ms)')}
                    type="number"
                    placeholder="10000"
                    value={retry.maxIntervalMs ?? ''}
                    onChange={(event) => patchRetry({ maxIntervalMs: parseNumber(event.target.value) })}
                  />
                </div>
              </div>
              <CheckboxField
                label={t('workflows.activityDialog.async', 'Run asynchronously')}
                checked={!!working.async}
                onCheckedChange={(checked) => setWorking((current) => (current ? { ...current, async: checked === true } : current))}
              />
            </div>
          </details>

          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onOpenFullTransition()
            }}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t('workflows.activityDialog.openFull', 'Open full transition…')}
          </button>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="destructive-outline"
            onClick={() => {
              onRemove()
              onOpenChange(false)
            }}
          >
            {t('workflows.activityDialog.remove', 'Remove activity')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={handleSave}>
              {t('workflows.activityDialog.save', 'Save activity')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
